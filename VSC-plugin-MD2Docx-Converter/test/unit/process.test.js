'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { execExecutable } = require('../../out/process.js');
const { CancellationTokenSource } = require('./support/vscode-stub.js');

const NODE = process.execPath;

test('multi-byte characters survive a chunk boundary', async () => {
    // 500 000 CJK characters are 1.5 MB of UTF-8, so the pipe splits them
    // across many chunks and a character is cut in half at some boundary.
    const script = 'process.stdout.write("中".repeat(500000));';

    const { stdout } = await execExecutable(NODE, ['-e', script], { shell: false });

    assert.equal(
        stdout.includes('�'),
        false,
        'a multi-byte character split across two chunks must not become U+FFFD'
    );
    assert.equal(stdout.length, 500000, 'every character has to survive');
});

test('the output limit counts bytes and stops the collection', async () => {
    // 400 CJK characters are 1200 UTF-8 bytes but only 400 UTF-16 units.
    const script = 'process.stdout.write("中".repeat(400));';

    await assert.rejects(
        execExecutable(NODE, ['-e', script], { shell: false, maxBuffer: 1000 }),
        (error) => {
            assert.equal(
                error.code,
                'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
                `the limit has to be reported as such: ${error.message}`
            );
            assert.ok(
                error.stdout.length <= 1000,
                `the collected output must stay within the limit: ${error.stdout.length}`
            );
            return true;
        }
    );
});

test('a process killed by a signal reports the signal', { skip: process.platform === 'win32' }, async () => {
    const script = "process.kill(process.pid, 'SIGTERM'); setTimeout(() => {}, 60000);";

    await assert.rejects(
        execExecutable(NODE, ['-e', script], { shell: false }),
        (error) => {
            assert.match(
                error.message,
                /SIGTERM/,
                `the error has to name the signal: ${error.message}`
            );
            return true;
        }
    );
});

test('cancelling the token stops the child process', async () => {
    const source = new CancellationTokenSource();
    const script = 'setTimeout(() => {}, 60000);';

    const running = execExecutable(NODE, ['-e', script], { shell: false, token: source.token });
    setTimeout(() => source.cancel(), 200);

    await assert.rejects(running, (error) => {
        assert.notEqual(error.code, 0, 'a cancelled process must not report success');
        return true;
    });
});

test('the working directory is honoured', async () => {
    const { stdout } = await execExecutable(NODE, ['-e', 'process.stdout.write(process.cwd())'], {
        shell: false,
        cwd: path.join(__dirname, '..', '..')
    });

    assert.match(stdout, /VSC-plugin-MD2Docx-Converter$/);
});
