'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    createExtensionContext,
    createVscodeStub,
    loadExtension,
    makeTempDir
} = require('./support/vscode-stub.js');

const EXPORT_COMMAND_ID = 'mdocxConverter.exportToDocx';
const CHECK_ENVIRONMENT_COMMAND_ID = 'mdocxConverter.checkEnvironment';
const RENDER_MERMAID_COMMAND_ID = 'mdocxConverter.renderMermaidToImage';

test('untrusted workspaces are blocked before an export starts', async (t) => {
    const dir = makeTempDir('mdocx-untrusted-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    const stub = createVscodeStub({ trusted: false });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    assert.ok(handler, 'the export command must be registered');
    await handler(stub.Uri.file(markdownPath));

    assert.equal(
        stub.state.progress.tokenSource,
        undefined,
        'an untrusted workspace must not start an export'
    );
    assert.ok(
        stub.state.messages.some(
            (entry) => entry.level === 'error' && /trust/i.test(entry.message)
        ),
        `the user must be told to trust the workspace: ${JSON.stringify(stub.state.messages)}`
    );
});

test('all other commands also refuse an untrusted workspace', async (t) => {
    const dir = makeTempDir('mdocx-untrusted-commands-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    for (const commandId of [CHECK_ENVIRONMENT_COMMAND_ID, RENDER_MERMAID_COMMAND_ID]) {
        const stub = createVscodeStub({ trusted: false });
        const extension = loadExtension(stub);
        extension.activate(createExtensionContext());

        const handler = stub.state.commands.get(commandId);
        assert.ok(handler, `${commandId} must be registered`);
        await handler(stub.Uri.file(markdownPath));

        assert.equal(stub.state.progress.tokenSource, undefined);
        assert.ok(
            stub.state.messages.some(
                (entry) => entry.level === 'error' && /trust/i.test(entry.message)
            ),
            `${commandId} must report the trust requirement`
        );
    }
});
