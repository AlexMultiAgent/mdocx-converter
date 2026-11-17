'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const {
    BUNDLED_TEMPLATE,
    createExtensionContext,
    createVscodeStub,
    isProcessAlive,
    loadExtension,
    makeTempDir,
    startFakeMermaidInkServer,
    waitForFile,
    withTimeout,
    writeFakePandoc
} = require('./support/vscode-stub.js');

const EXPORT_COMMAND_ID = 'mdocxConverter.exportToDocx';

function makeReferenceWithBrokenOrder(directory) {
    const zip = new AdmZip(BUNDLED_TEMPLATE);
    const stylesEntry = zip.getEntry('word/styles.xml');
    let styles = stylesEntry.getData().toString('utf8');
    const normal = styles.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)?.[0];
    const spacing = normal?.match(/<w:spacing\b[^>]*\/>/)?.[0];
    assert.ok(normal && spacing, 'the bundled template must contain Normal spacing');

    const brokenNormal = normal
        .replace(spacing, '')
        .replace('</w:pPr>', `${spacing}</w:pPr>`);
    styles = styles.replace(normal, brokenNormal);
    zip.updateFile(stylesEntry, Buffer.from(styles, 'utf8'));

    const reference = path.join(directory, 'broken-order-reference.docx');
    zip.writeZip(reference);
    return reference;
}

function stageOf(message) {
    if (typeof message !== 'string') {
        return undefined;
    }

    if (message.startsWith('Rendering Mermaid diagrams')) {
        return 'Rendering Mermaid diagrams';
    }

    return message;
}

function runExport(stub, markdownPath) {
    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    assert.ok(handler, 'the export command must be registered');
    return handler(stub.Uri.file(markdownPath));
}

test('the export reports the four stages in order', async (t) => {
    const dir = makeTempDir('mdocx-progress-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(
        markdownPath,
        '# Title\n\n```mermaid\ngraph TD;\nA-->B;\n```\n\nBody text.\n',
        'utf8'
    );

    const fakePandoc = writeFakePandoc(dir);
    const server = await startFakeMermaidInkServer();
    t.after(() => server.close());

    const stub = createVscodeStub({
        config: {
            pandocPath: fakePandoc,
            mermaidRenderer: 'api',
            mermaidApiUrl: server.url
        }
    });

    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    await withTimeout(runExport(stub, markdownPath), 30000, 'export');

    const messages = stub.state.progress.reports.map((report) => report.message);
    assert.deepEqual(messages.map(stageOf), [
        'Preparing Markdown',
        'Rendering Mermaid diagrams',
        'Running Pandoc',
        'Applying styles'
    ]);

    // The mermaid counter has to reach the number of diagrams.
    assert.ok(
        messages.some((message) => message === 'Rendering Mermaid diagrams (1/1)'),
        `the mermaid progress counter never advanced: ${JSON.stringify(messages)}`
    );

    // The stages are visible in the output panel as well.
    const outputLines = stub.state.outputLines;
    assert.ok(outputLines.includes('Preparing Markdown'), 'the output panel must show the stages');
    assert.ok(outputLines.includes('Running Pandoc'), 'the output panel must show the stages');
    assert.ok(outputLines.includes('Applying styles'), 'the output panel must show the stages');

    assert.ok(
        stub.state.messages.some((entry) => entry.level === 'info' && entry.message.includes('exported successfully')),
        `the export must succeed: ${JSON.stringify(stub.state.messages)}`
    );
});

test('the progress notification is cancellable', async (t) => {
    const dir = makeTempDir('mdocx-progress-options-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\nBody.\n', 'utf8');

    const fakePandoc = writeFakePandoc(dir);
    const stub = createVscodeStub({ config: { pandocPath: fakePandoc } });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    await withTimeout(runExport(stub, markdownPath), 30000, 'export');

    assert.equal(stub.state.progress.options.cancellable, true);
    assert.equal(stub.state.progress.options.location, stub.ProgressLocation.Notification);
});

test('the template profile repairs style property order', async (t) => {
    const dir = makeTempDir('mdocx-template-order-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\nBody.\n', 'utf8');
    const reference = makeReferenceWithBrokenOrder(dir);
    const fakePandoc = writeFakePandoc(dir, reference);

    const stub = createVscodeStub({
        config: {
            pandocPath: fakePandoc,
            styleProfile: 'template'
        }
    });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    await withTimeout(runExport(stub, markdownPath), 30000, 'template export');

    const output = path.join(dir, 'doc.docx');
    const zip = new AdmZip(output);
    const styles = zip.readAsText('word/styles.xml');
    const normal = styles.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)?.[0];
    const spacingIndex = normal.indexOf('<w:spacing');
    const justificationIndex = normal.indexOf('<w:jc');
    assert.ok(spacingIndex >= 0 && justificationIndex >= 0);
    assert.ok(
        spacingIndex < justificationIndex,
        `w:spacing must precede w:jc: ${normal}`
    );
});

test('the mermaid counter advances for every diagram, including failed ones', async (t) => {
    const dir = makeTempDir('mdocx-progress-counter-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(
        markdownPath,
        '# Title\n\n'
        + '```mermaid\ngraph TD;\nA-->B;\n```\n\n'
        + '```mermaid\ngraph TD;\nFAIL-->B;\n```\n\n'
        + '```mermaid\ngraph TD;\nC-->D;\n```\n\n',
        'utf8'
    );

    const fakePandoc = writeFakePandoc(dir);
    const server = await startFakeMermaidInkServer();
    t.after(() => server.close());

    const stub = createVscodeStub({
        config: {
            pandocPath: fakePandoc,
            mermaidRenderer: 'api',
            mermaidApiUrl: server.url
        }
    });

    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    await withTimeout(runExport(stub, markdownPath), 60000, 'export');

    const counters = stub.state.progress.reports
        .map((report) => report.message)
        .filter((message) => typeof message === 'string' && message.startsWith('Rendering Mermaid diagrams'));

    assert.equal(counters.length, 3, `every diagram must advance the counter: ${JSON.stringify(counters)}`);
    assert.deepEqual(
        counters.slice().sort(),
        [
            'Rendering Mermaid diagrams (1/3)',
            'Rendering Mermaid diagrams (2/3)',
            'Rendering Mermaid diagrams (3/3)'
        ]
    );
});

test('cancelling the export kills the pandoc process', async (t) => {
    const dir = makeTempDir('mdocx-cancel-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const pidFile = path.join(dir, 'pandoc.pid');

    // The "markdown" is a Node program: the fake pandoc is Node itself, so
    // the file is both the document and the child process. It writes its own
    // PID and then waits for two minutes.
    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(
        markdownPath,
        [
            "const fs = require('fs');",
            "const path = require('path');",
            "fs.writeFileSync(path.join(__dirname, 'pandoc.pid'), String(process.pid));",
            'setTimeout(() => { fs.writeFileSync(path.join(__dirname, \'pandoc.done\'), \'done\'); }, 120000);'
        ].join('\n'),
        'utf8'
    );

    const stub = createVscodeStub({ config: { pandocPath: process.execPath } });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const exportPromise = runExport(stub, markdownPath);

    const pid = Number(await waitForFile(pidFile, 30000));

    // The fake pandoc must never outlive the test, not even when the
    // assertions below fail.
    t.after(() => {
        if (isProcessAlive(pid)) {
            try {
                process.kill(pid);
            } catch {
                // Already gone.
            }
        }
    });

    assert.ok(pid > 0, 'the fake pandoc must report its PID');

    stub.state.progress.tokenSource.cancel();

    await withTimeout(exportPromise, 30000, 'cancelled export');

    assert.ok(
        stub.state.outputLines.includes('Export cancelled.'),
        `the export must report the cancellation: ${JSON.stringify(stub.state.outputLines)}`
    );
    assert.ok(
        !stub.state.outputLines.some((line) => line.startsWith('Export completed')),
        'a cancelled export must not report success'
    );
    assert.ok(
        stub.state.messages.some((entry) => entry.message === 'Export cancelled.'),
        `the user must see a cancellation notice: ${JSON.stringify(stub.state.messages)}`
    );

    // The child must be gone — the fake pandoc would have run for two
    // minutes, so a fast exit means it really was terminated.
    assert.equal(isProcessAlive(pid), false, `the pandoc process ${pid} must be terminated`);
    assert.equal(fs.existsSync(path.join(dir, 'pandoc.done')), false, 'the fake pandoc must not have finished');
});

test('the styles stage is announced before the styles are applied', async (t) => {
    const dir = makeTempDir('mdocx-stage-order-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\nBody text.\n', 'utf8');

    const fakePandoc = writeFakePandoc(dir);
    const stub = createVscodeStub({
        config: {
            pandocPath: fakePandoc,
            styleProfile: 'academic'
        }
    });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    await withTimeout(runExport(stub, markdownPath), 30000, 'export');

    const lines = stub.state.outputLines;
    const announced = lines.indexOf('Applying styles');
    const applied = lines.indexOf('Applied DOCX style overrides.');

    assert.ok(announced >= 0, `the stage has to be announced: ${JSON.stringify(lines)}`);
    assert.ok(applied >= 0, `the overrides have to be applied: ${JSON.stringify(lines)}`);
    assert.ok(
        announced < applied,
        `the stage has to come before the work: ${JSON.stringify(lines)}`
    );
});
