'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
    EXTENSION_ROOT,
    createExtensionContext,
    createVscodeStub,
    loadExtension,
    makeTempDir,
    startFakeMermaidInkServer,
    withTimeout
} = require('./support/vscode-stub.js');

const CHECK_ENVIRONMENT_COMMAND_ID = 'mdocxConverter.checkEnvironment';

function countBundledTemplates() {
    const templateDir = path.join(EXTENSION_ROOT, 'multi-templates');
    return fs.readdirSync(templateDir).filter((name) => name.endsWith('.docx')).length;
}

async function runCheck(stub, markdownPath) {
    const handler = stub.state.commands.get(CHECK_ENVIRONMENT_COMMAND_ID);
    assert.ok(handler, 'the checkEnvironment command must be registered');
    await withTimeout(handler(stub.Uri.file(markdownPath)), 60000, 'checkEnvironment');
    return stub.state.outputLines;
}

test('checkEnvironment reports the renderer, the API, the template count and the profile', async (t) => {
    const dir = makeTempDir('mdocx-check-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    const server = await startFakeMermaidInkServer();
    t.after(() => server.close());

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'api',
            mermaidApiUrl: server.url,
            styleProfile: 'academic'
        }
    });

    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const lines = await runCheck(stub, markdownPath);

    assert.ok(lines.includes(`Mermaid renderer: api`), `missing renderer line: ${JSON.stringify(lines)}`);
    assert.ok(lines.includes(`OK Mermaid Ink API: ${server.url}`), `missing API line: ${JSON.stringify(lines)}`);
    assert.ok(
        lines.includes(`Bundled templates: ${countBundledTemplates()}`),
        `missing template count: ${JSON.stringify(lines)}`
    );
    assert.ok(lines.includes('Active style profile: academic'), `missing profile line: ${JSON.stringify(lines)}`);
});

test('checkEnvironment reports an unreachable Mermaid Ink API instead of throwing', async (t) => {
    const dir = makeTempDir('mdocx-check-unreachable-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'api',
            mermaidApiUrl: 'http://127.0.0.1:1'
        }
    });

    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const lines = await runCheck(stub, markdownPath);

    assert.ok(
        lines.includes('UNREACHABLE Mermaid Ink API: http://127.0.0.1:1'),
        `missing unreachable line: ${JSON.stringify(lines)}`
    );
});

test('checkEnvironment survives a Mermaid Ink host that does not exist', async (t) => {
    const dir = makeTempDir('mdocx-check-missing-host-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'api',
            mermaidApiUrl: 'http://mdocx-no-such-host.invalid'
        }
    });

    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const lines = await runCheck(stub, markdownPath);

    assert.ok(
        lines.includes('UNREACHABLE Mermaid Ink API: http://mdocx-no-such-host.invalid'),
        `missing unreachable line: ${JSON.stringify(lines)}`
    );
    assert.ok(
        !stub.state.messages.some((entry) => entry.level === 'error'),
        `checkEnvironment must not raise an error: ${JSON.stringify(stub.state.messages)}`
    );
});

test('checkEnvironment reports the renderer mode even without an API check', async (t) => {
    const dir = makeTempDir('mdocx-check-local-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    const stub = createVscodeStub({ config: { mermaidRenderer: 'local' } });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const lines = await runCheck(stub, markdownPath);

    assert.ok(lines.includes('Mermaid renderer: local'), `missing renderer line: ${JSON.stringify(lines)}`);
    assert.ok(
        !lines.some((line) => line.includes('Mermaid Ink API')),
        `the local renderer must not probe the API: ${JSON.stringify(lines)}`
    );
});
