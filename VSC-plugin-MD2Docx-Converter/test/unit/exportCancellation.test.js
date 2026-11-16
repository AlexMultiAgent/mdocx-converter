'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    createExtensionContext,
    createVscodeStub,
    isProcessAlive,
    loadExtension,
    makeTempDir,
    waitForFile,
    withTimeout
} = require('./support/vscode-stub.js');

const EXPORT_COMMAND_ID = 'mdocxConverter.exportToDocx';

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
