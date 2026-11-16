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
const EXPORT_COMMAND_ID = 'mdocxConverter.exportToDocx';

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

test('checkEnvironment does not call the environment ready when the API is unreachable', async (t) => {
    const dir = makeTempDir('mdocx-check-unreachable-verdict-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    const stub = createVscodeStub({
        config: {
            // With the 'api' renderer the service is the only Mermaid path.
            mermaidRenderer: 'api',
            mermaidApiUrl: 'http://127.0.0.1:1'
        }
    });

    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    await runCheck(stub, markdownPath);

    assert.ok(
        !stub.state.messages.some((entry) => /looks ready/.test(entry.message)),
        `the environment must not be reported as ready: ${JSON.stringify(stub.state.messages)}`
    );
    assert.ok(
        stub.state.messages.some((entry) => entry.level === 'warning' && /Mermaid Ink API/.test(entry.message)),
        `the unreachable API has to be reported: ${JSON.stringify(stub.state.messages)}`
    );
});

test('checkEnvironment does not call the API ready when it answers without a PNG', async (t) => {
    const dir = makeTempDir('mdocx-check-not-a-png-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n', 'utf8');

    // A service that answers 200 with something that is not a diagram.
    const server = await startFakeMermaidInkServer({ body: '<html>not a diagram</html>' });
    t.after(() => server.close());

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'api',
            mermaidApiUrl: server.url
        }
    });

    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const lines = await runCheck(stub, markdownPath);

    assert.ok(
        !lines.includes(`OK Mermaid Ink API: ${server.url}`),
        `a service that returns no diagram must not be reported as OK: ${JSON.stringify(lines)}`
    );
});

test('the privacy notice appears before the diagram content is sent', async (t) => {
    const dir = makeTempDir('mdocx-privacy-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\n```mermaid\ngraph TD;\nA-->B;\n```\n', 'utf8');

    const requests = [];
    const server = await startFakeMermaidInkServer({
        onRequest: () => requests.push(Date.now())
    });
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
    await handler(stub.Uri.file(markdownPath));

    const notice = stub.state.messages.find((entry) => /Mermaid Ink API/.test(entry.message));
    assert.ok(notice, `the privacy notice must be shown: ${JSON.stringify(stub.state.messages)}`);
    assert.ok(requests.length > 0, 'the diagram has to reach the service');
    assert.ok(
        notice.at <= requests[0],
        `the notice has to come before the content leaves the machine: notice ${notice.at}, request ${requests[0]}`
    );
});

test('the privacy notice appears when the local Mermaid CLI fails', async (t) => {
    const dir = makeTempDir('mdocx-privacy-fallback-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const markdownPath = path.join(dir, 'doc.md');
    fs.writeFileSync(markdownPath, '# Title\n\n```mermaid\ngraph TD;\nA-->B;\n```\n', 'utf8');

    // A Mermaid CLI that answers --version but fails every render, so the
    // export falls back to the Mermaid Ink API.
    const fakeCli = path.join(dir, 'fake-mmdc.cmd');
    fs.writeFileSync(
        fakeCli,
        '@echo off\r\n'
        + 'if "%1"=="--version" (echo fake-mmdc 1.0 & exit /b 0)\r\n'
        + 'exit /b 1\r\n',
        'utf8'
    );

    const requests = [];
    const server = await startFakeMermaidInkServer({
        onRequest: () => requests.push(Date.now())
    });
    t.after(() => server.close());

    const stub = createVscodeStub({
        config: {
            mermaidRenderer: 'auto',
            mermaidCliPath: fakeCli,
            mermaidApiUrl: server.url
        }
    });
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const handler = stub.state.commands.get(EXPORT_COMMAND_ID);
    await withTimeout(handler(stub.Uri.file(markdownPath)), 30000, 'export');

    const notice = stub.state.messages.find((entry) => /Mermaid Ink API/.test(entry.message));
    assert.ok(notice, `the privacy notice must be shown: ${JSON.stringify(stub.state.messages)}`);
    assert.ok(requests.length > 0, 'the diagram has to reach the service');
    assert.ok(
        notice.at <= requests[0],
        `the notice has to come before the content leaves the machine: notice ${notice.at}, request ${requests[0]}`
    );
});
