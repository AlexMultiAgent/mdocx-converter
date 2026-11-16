'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    createExtensionContext,
    createVscodeStub,
    isProcessAlive,
    loadExtension,
    makeTempDir,
    startFakeMermaidInkServer,
    waitForFile,
    withTimeout
} = require('./support/vscode-stub.js');

const EXPORT_COMMAND_ID = 'mdocxConverter.exportToDocx';

// The extension creates its temporary directory in os.tmpdir(). The test
// runner runs the test files in parallel, and another file creates
// directories there as well — so this file gets a directory of its own and
// only ever sees what it created itself.
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mdocx-test-tmp-'));
process.env.TMPDIR = TEMP_ROOT;
process.env.TEMP = TEMP_ROOT;
process.env.TMP = TEMP_ROOT;
process.on('exit', () => {
    fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
});

/** The temporary directories the extension creates for the Mermaid assets. */
function tempDirs() {
    return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('mdocx-converter-'));
}

/**
 * A fake pandoc that starts a grandchild process and waits for it.
 *
 * On Windows the extension runs a `.cmd` through `cmd.exe`, so the process
 * the extension spawns is `cmd.exe` and the real work happens in a grandchild.
 * Killing `cmd.exe` leaves the grandchild alive — and the grandchild still
 * holds the inherited stdout pipe, so the 'close' event never arrives.
 */
function writeFakePandocWithGrandchild(dir) {
    const helper = path.join(dir, 'fake-pandoc.js');
    fs.writeFileSync(
        helper,
        [
            "const fs = require('fs');",
            "const path = require('path');",
            "const { spawn } = require('child_process');",
            // The grandchild inherits our stdout, so it keeps the pipe open.
            "const grandchild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'inherit' });",
            "fs.writeFileSync(path.join(__dirname, 'grandchild.pid'), String(grandchild.pid));",
            'setTimeout(() => {}, 120000);'
        ].join('\n'),
        'utf8'
    );

    if (process.platform === 'win32') {
        const file = path.join(dir, 'fake-pandoc.cmd');
        fs.writeFileSync(
            file,
            '@echo off\r\n'
            + 'if "%1"=="--version" (echo fake-pandoc 1.0 & exit /b 0)\r\n'
            + `node "${helper}" %*\r\n`,
            'utf8'
        );
        return file;
    }

    const file = path.join(dir, 'fake-pandoc.sh');
    fs.writeFileSync(
        file,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fake-pandoc 1.0"; exit 0; fi\n`
        + `node "${helper}" "$@"\n`,
        'utf8'
    );
    fs.chmodSync(file, 0o755);
    return file;
}

test('cancelling an export terminates the whole process tree', async (t) => {
    const dir = makeTempDir('mdocx-tree-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\nBody.\n', 'utf8');

    const pidFile = path.join(dir, 'grandchild.pid');
    const fakePandoc = writeFakePandocWithGrandchild(dir);

    const stub = createVscodeStub({ config: { pandocPath: fakePandoc } });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    assert.ok(handler, 'the export command must be registered');

    const exportPromise = handler(stub.Uri.file(markdownPath));

    const grandchildPid = Number(await waitForFile(pidFile, 30000));

    // The grandchild must never outlive the test, even when the assertions
    // below fail.
    t.after(() => {
        if (isProcessAlive(grandchildPid)) {
            try {
                process.kill(grandchildPid);
            } catch {
                // Already gone.
            }
        }
    });

    stub.state.progress.tokenSource.cancel();

    // The export has to settle. A `cmd.exe` kill leaves the grandchild alive
    // with the inherited stdout pipe open, so the 'close' event never fires
    // and the export hangs until the grandchild exits on its own.
    await withTimeout(exportPromise, 15000, 'cancelled export');

    assert.ok(
        stub.state.outputLines.includes('Export cancelled.'),
        `the export must report the cancellation: ${JSON.stringify(stub.state.outputLines)}`
    );
    assert.ok(
        !stub.state.outputLines.some((line) => line.startsWith('Export completed')),
        'a cancelled export must not report success'
    );

    // Give the process table a moment to settle.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
        isProcessAlive(grandchildPid),
        false,
        `the grandchild process ${grandchildPid} must be terminated with the tree`
    );
});

/**
 * A fake pandoc that writes a partial file to `--output` and then hangs.
 */
function writeFakePandocThatStalls(dir) {
    const helper = path.join(dir, 'fake-pandoc.js');
    fs.writeFileSync(
        helper,
        [
            "const fs = require('fs');",
            "const args = process.argv.slice(2);",
            "const i = args.indexOf('--output');",
            "if (i >= 0 && args[i + 1]) { fs.writeFileSync(args[i + 1], Buffer.alloc(4096, 65)); }",
            'setTimeout(() => {}, 120000);'
        ].join('\n'),
        'utf8'
    );

    if (process.platform === 'win32') {
        const file = path.join(dir, 'fake-pandoc.cmd');
        fs.writeFileSync(
            file,
            '@echo off\r\n'
            + 'if "%1"=="--version" (echo fake-pandoc 1.0 & exit /b 0)\r\n'
            + `node "${helper}" %*\r\n`,
            'utf8'
        );
        return file;
    }

    const file = path.join(dir, 'fake-pandoc.sh');
    fs.writeFileSync(
        file,
        `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fake-pandoc 1.0"; exit 0; fi\n`
        + `node "${helper}" "$@"\n`,
        'utf8'
    );
    fs.chmodSync(file, 0o755);
    return file;
}

/**
 * Wait until the export has started writing its staging document.
 */
function waitForStagingFile(dir, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const check = () => {
            const staging = fs.readdirSync(dir).filter((name) => name.includes('.mdocx-'));
            if (staging.length > 0) {
                resolve(path.join(dir, staging[0]));
                return;
            }

            if (Date.now() > deadline) {
                reject(new Error(`Timed out waiting for a staging file in ${dir}`));
                return;
            }

            setTimeout(check, 25);
        };

        check();
    });
}

test('a cancelled export leaves no file behind at the output path', async (t) => {
    const dir = makeTempDir('mdocx-partial-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\nBody.\n', 'utf8');

    const outputPath = path.join(dir, 'doc.docx');
    const fakePandoc = writeFakePandocThatStalls(dir);

    const stub = createVscodeStub({ config: { pandocPath: fakePandoc } });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    const exportPromise = handler(stub.Uri.file(markdownPath));

    // Wait until the fake pandoc has written its partial file.
    await waitForStagingFile(dir, 30000);

    stub.state.progress.tokenSource.cancel();
    await withTimeout(exportPromise, 15000, 'cancelled export');

    assert.equal(
        fs.existsSync(outputPath),
        false,
        'a cancelled export must not leave a partial document at the output path'
    );
});


test('a cancelled export removes its temporary directory', async (t) => {
    const dir = makeTempDir('mdocx-tempdir-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    // Five diagrams with a concurrency of four: the fifth worker only starts
    // after the first four finished, which is after the cancel.
    const blocks = Array.from({ length: 5 }, (_, index) => `\`\`\`mermaid\ngraph TD;\nN${index}-->B;\n\`\`\``).join('\n\n');
    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, `# Title\n\n${blocks}\n`, 'utf8');

    const server = await startFakeMermaidInkServer({ delayMs: 2000 });
    t.after(() => server.close());

    const before = new Set(tempDirs());

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'api',
            mermaidApiUrl: server.url
        }
    });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    const exportPromise = handler(stub.Uri.file(markdownPath));

    setTimeout(() => stub.state.progress.tokenSource.cancel(), 300);
    await withTimeout(exportPromise, 30000, 'cancelled export');

    const leaked = tempDirs().filter((name) => !before.has(name));
    t.after(() => {
        for (const name of leaked) {
            fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
        }
    });

    assert.deepEqual(
        leaked,
        [],
        `a cancelled export must not leave its temporary directory behind: ${JSON.stringify(leaked)}`
    );
});

test('a real failure is not masked by a cancelled export', async (t) => {
    const dir = makeTempDir('mdocx-mask-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\n```mermaid\ngraph TD;\nA-->B;\n```\n', 'utf8');

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'api',
            // A malformed URL makes the preparation fail with a real error.
            mermaidApiUrl: 'not a url'
        },
        // The user hits Cancel while the export is being prepared. The
        // preparation then fails for its own reason, and that failure has to
        // be reported as a failure.
        onProgressReport: (value, tokenSource) => {
            if (value.message === 'Preparing Markdown') {
                tokenSource.cancel();
            }
        }
    });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    await handler(stub.Uri.file(markdownPath));

    assert.ok(
        !stub.state.outputLines.includes('Export cancelled.'),
        `a real failure must not be reported as a cancellation: ${JSON.stringify(stub.state.outputLines)}`
    );
    assert.ok(
        stub.state.messages.some((entry) => entry.level === 'error' && /Mermaid Ink URL/.test(entry.message)),
        `the real diagnostic must reach the user: ${JSON.stringify(stub.state.messages)}`
    );
});

test('cancelling the export stops the Mermaid Ink request', async (t) => {
    const dir = makeTempDir('mdocx-abort-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\n```mermaid\ngraph TD;\nA-->B;\n```\n', 'utf8');

    // The service takes its time; the export must not wait for it.
    const server = await startFakeMermaidInkServer({ delayMs: 20000 });
    t.after(() => server.close());

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'api',
            mermaidApiUrl: server.url
        }
    });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    const startedAt = Date.now();
    const exportPromise = handler(stub.Uri.file(markdownPath));

    setTimeout(() => stub.state.progress.tokenSource.cancel(), 300);
    await withTimeout(exportPromise, 8000, 'cancelled export');
    const elapsed = Date.now() - startedAt;

    assert.ok(
        elapsed < 8000,
        `the export must not wait for the service to answer: ${elapsed}ms`
    );
    assert.ok(
        stub.state.outputLines.includes('Export cancelled.'),
        `the export must report the cancellation: ${JSON.stringify(stub.state.outputLines)}`
    );
});
