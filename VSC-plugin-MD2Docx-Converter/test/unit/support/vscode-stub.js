'use strict';

/**
 * A stub of the `vscode` module plus a loader for `out/extension.js`.
 *
 * The extension host is not available to `node --test`, so the extension is
 * loaded with `Module._load` intercepting the `vscode` request. Everything
 * the extension touches at runtime is implemented here: the output channel,
 * the notification messages, the configuration, the command registry and
 * `window.withProgress` with a real cancellation token.
 */

const fs = require('fs');
const http = require('http');
const Module = require('module');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// test/unit/support -> test/unit -> test -> the extension root
const EXTENSION_ROOT = path.join(__dirname, '..', '..', '..');

/** A real DOCX the fake pandoc can copy — the style overrides need one. */
const BUNDLED_TEMPLATE = path.join(EXTENSION_ROOT, 'multi-templates', 'reference_english_academic.docx');

/** A 1x1 PNG — enough for the Mermaid Ink client's signature check. */
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

class CancellationTokenSource {
    constructor() {
        this._listeners = [];
        this._cancelled = false;

        const source = this;
        this.token = {
            get isCancellationRequested() {
                return source._cancelled;
            },
            onCancellationRequested(listener) {
                // VS Code fires late subscribers immediately when the token is
                // already cancelled, and the stub has to behave the same way.
                if (source._cancelled) {
                    listener();
                    return { dispose() { } };
                }

                source._listeners.push(listener);
                return {
                    dispose() {
                        const index = source._listeners.indexOf(listener);
                        if (index >= 0) {
                            source._listeners.splice(index, 1);
                        }
                    }
                };
            }
        };
    }

    cancel() {
        if (this._cancelled) {
            return;
        }

        this._cancelled = true;
        for (const listener of this._listeners.slice()) {
            listener();
        }
    }
}

function createConfig(values) {
    return {
        get(key, defaultValue) {
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : defaultValue;
        },
        inspect(key) {
            if (!Object.prototype.hasOwnProperty.call(values, key)) {
                return { key };
            }

            return {
                key,
                globalValue: values[key],
                workspaceValue: undefined,
                workspaceFolderValue: undefined
            };
        }
    };
}

function createVscodeStub(options = {}) {
    const state = {
        outputLines: [],
        messages: [],
        progress: {
            options: undefined,
            reports: [],
            tokenSource: undefined
        },
        commands: new Map(),
        executedCommands: [],
        config: options.config || {}
    };

    const outputChannel = {
        name: 'mdocx-converter',
        appendLine(line) {
            state.outputLines.push(String(line));
        },
        append(text) {
            state.outputLines.push(String(text));
        },
        clear() {
            state.outputLines.length = 0;
        },
        show() { },
        hide() { },
        dispose() { }
    };

    const record = (level) => (message) => {
        state.messages.push({ level, message: String(message), at: Date.now() });
        return Promise.resolve(undefined);
    };

    const window = {
        activeTextEditor: undefined,
        createOutputChannel: () => outputChannel,
        showInformationMessage: record('info'),
        showWarningMessage: record('warning'),
        showErrorMessage: record('error'),
        withProgress: async (progressOptions, task) => {
            const tokenSource = new CancellationTokenSource();
            state.progress.options = progressOptions;
            state.progress.tokenSource = tokenSource;
            state.progress.reports = [];

            const progress = {
                report(value) {
                    state.progress.reports.push(value);
                    if (options.onProgressReport) {
                        options.onProgressReport(value, tokenSource, state);
                    }
                }
            };

            return task(progress, tokenSource.token);
        }
    };

    const workspace = {
        workspaceFolders: options.workspaceFolders,
        getConfiguration: (section) => createConfig(section === 'mdocxConverter' ? state.config : {}),
        getWorkspaceFolder: () => undefined
    };

    const commands = {
        registerCommand: (id, handler) => {
            state.commands.set(id, handler);
            return {
                dispose() {
                    state.commands.delete(id);
                }
            };
        },
        executeCommand: async (id, ...args) => {
            state.executedCommands.push({ id, args });
            return undefined;
        }
    };

    const Uri = {
        file: (filePath) => ({
            fsPath: filePath,
            path: filePath,
            scheme: 'file',
            toString: () => `file://${filePath}`
        }),
        parse: (value) => ({
            fsPath: value,
            path: value,
            scheme: 'file',
            toString: () => value
        })
    };

    class Position {
        constructor(line, character) {
            this.line = line;
            this.character = character;
        }
    }

    class Range {
        constructor(start, end) {
            this.start = start;
            this.end = end;
        }
    }

    class Selection {
        constructor(anchor, active) {
            this.anchor = anchor;
            this.active = active;
        }
    }

    return {
        state,
        window,
        workspace,
        commands,
        Uri,
        Position,
        Range,
        Selection,
        ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
        env: { openExternal: async () => true },
        Disposable: class {
            constructor(callOnDispose) {
                this.callOnDispose = callOnDispose;
            }

            dispose() {
                if (this.callOnDispose) {
                    this.callOnDispose();
                }
            }
        }
    };
}

/**
 * Load the compiled extension with `vscode` replaced by the stub.
 *
 * The interception is only active while the module is required — the module
 * keeps the stub object for later calls.
 */
function loadExtension(stub) {
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === 'vscode') {
            return stub;
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const extensionPath = require.resolve(path.join(EXTENSION_ROOT, 'out', 'extension.js'));
        delete require.cache[extensionPath];
        return require(extensionPath);
    } finally {
        Module._load = originalLoad;
    }
}

function createExtensionContext() {
    const globalState = new Map();
    return {
        extensionPath: EXTENSION_ROOT,
        subscriptions: [],
        globalState: {
            get(key, defaultValue) {
                return globalState.has(key) ? globalState.get(key) : defaultValue;
            },
            update(key, value) {
                globalState.set(key, value);
                return Promise.resolve();
            }
        }
    };
}

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * A fake `pandoc` that copies a bundled template to the requested output.
 *
 * `--version` has to succeed, otherwise the extension falls through to the
 * real pandoc on this machine. The output has to be a real DOCX, otherwise
 * the style override step has nothing to open.
 */
function writeFakePandoc(dir, templatePath = BUNDLED_TEMPLATE) {
    const helper = path.join(dir, 'fake-pandoc.js');
    fs.writeFileSync(
        helper,
        [
            "const fs = require('fs');",
            "const args = process.argv.slice(2);",
            'const outputIndex = args.indexOf(\'--output\');',
            'if (outputIndex >= 0 && args[outputIndex + 1]) {',
            `    fs.copyFileSync(${JSON.stringify(templatePath)}, args[outputIndex + 1]);`,
            '}',
            'process.exit(0);'
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
 * A fake Mermaid Ink service.
 *
 * It answers `/img/pako:<payload>` with a PNG. A diagram whose source
 * contains `FAIL` is answered with HTTP 500 instead, so the fallback path of
 * the renderer can be exercised.
 */
async function startFakeMermaidInkServer(options = {}) {
    const delayMs = options.delayMs ?? 0;
    const onRequest = options.onRequest;
    const body = options.body;
    const server = http.createServer((request, response) => {
        if (onRequest) {
            onRequest(request.url || '');
        }

        const requestPath = (request.url || '').split('?')[0];
        const marker = requestPath.indexOf('/img/pako:');
        let diagram = '';

        if (marker >= 0) {
            const payload = requestPath.slice(marker + '/img/pako:'.length);
            try {
                diagram = JSON.parse(
                    zlib.inflateSync(Buffer.from(payload, 'base64url')).toString('utf8')
                ).code || '';
            } catch {
                diagram = '';
            }
        }

        const respond = () => {
            if (body !== undefined) {
                response.writeHead(200, { 'Content-Type': 'text/html' });
                response.end(body);
                return;
            }

            if (diagram.includes('FAIL')) {
                response.writeHead(500, { 'Content-Type': 'text/plain' });
                response.end('boom');
                return;
            }

            response.writeHead(200, { 'Content-Type': 'image/png' });
            response.end(PNG_1X1);
        };

        if (delayMs > 0) {
            setTimeout(respond, delayMs);
            return;
        }

        respond();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    return {
        server,
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolve) => server.close(() => resolve()))
    };
}

function waitForFile(filePath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const check = () => {
            if (fs.existsSync(filePath)) {
                resolve(fs.readFileSync(filePath, 'utf8'));
                return;
            }

            if (Date.now() > deadline) {
                reject(new Error(`Timed out waiting for ${filePath}`));
                return;
            }

            setTimeout(check, 25);
        };

        check();
    });
}

function withTimeout(promise, timeoutMs, label) {
    let timer;
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    EXTENSION_ROOT,
    BUNDLED_TEMPLATE,
    PNG_1X1,
    CancellationTokenSource,
    createConfig,
    createExtensionContext,
    createVscodeStub,
    isProcessAlive,
    loadExtension,
    makeTempDir,
    startFakeMermaidInkServer,
    waitForFile,
    withTimeout,
    writeFakePandoc
};
