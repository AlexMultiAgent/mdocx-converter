'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { execExecutable } = require('../../out/process.js');
const { CancellationTokenSource, makeTempDir } = require('./support/vscode-stub.js');

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

/** Arguments that a command processor would treat as syntax, not as text. */
const NASTY_ARGUMENTS = [
    'plain.txt',
    'a & b.txt',
    'a | b.txt',
    'a > b.txt',
    'a < b.txt',
    'a ^ b.txt',
    'a %PATH% b',
    'a !PATH! b',
    'a "quoted" b',
    'a(b).txt',
    'a;b.txt',
    'a,b.txt',
    'a`b`.txt',
    'C:\\Users\\Test & Co\\file.txt',
    '中文 文件.txt',
    'trailing\\',
    ''
];

/**
 * A `.cmd` that forwards its arguments to a node script, which records them.
 */
function writeArgumentRecorder(dir) {
    const recordFile = path.join(dir, 'argv.json');
    const helper = path.join(dir, 'record.js');
    fs.writeFileSync(
        helper,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify(process.argv.slice(2)));\n`,
        'utf8'
    );

    const cmd = path.join(dir, 'record.cmd');
    fs.writeFileSync(cmd, `@echo off\r\nnode "${helper}" %*\r\n`, 'utf8');

    return { cmd, recordFile };
}

test('shell arguments reach the program unchanged', { skip: process.platform !== 'win32' }, async (t) => {
    const dir = makeTempDir('mdocx-escape-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const { cmd, recordFile } = writeArgumentRecorder(dir);

    for (const argument of NASTY_ARGUMENTS) {
        await execExecutable(cmd, ['--flag', argument], { shell: true });

        const received = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
        assert.deepEqual(
            received,
            ['--flag', argument],
            `the argument ${JSON.stringify(argument)} must arrive unchanged`
        );
    }
});

test('an argument cannot run a second command', { skip: process.platform !== 'win32' }, async (t) => {
    const dir = makeTempDir('mdocx-inject-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const { cmd } = writeArgumentRecorder(dir);
    const marker = path.join(dir, 'INJECTED.txt');
    const payload = `x & node -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')"`;

    await execExecutable(cmd, ['--flag', payload], { shell: true });

    assert.equal(
        fs.existsSync(marker),
        false,
        'a metacharacter in an argument must not run a second command'
    );
});

test('a batch file still sees its argument unquoted', { skip: process.platform !== 'win32' }, async (t) => {
    const dir = makeTempDir('mdocx-percent-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    // A batch file that compares `%1` against a literal only works when the
    // argument arrives without the quotes the escaping added.
    const cmd = path.join(dir, 'probe.cmd');
    fs.writeFileSync(
        cmd,
        '@echo off\r\n'
        + 'if "%1"=="--version" (echo VERSION-MATCH & exit /b 0)\r\n'
        + 'echo NO-MATCH\r\n',
        'utf8'
    );

    const { stdout } = await execExecutable(cmd, ['--version'], { shell: true });

    assert.match(stdout, /VERSION-MATCH/, `the batch file must see the plain argument: ${stdout}`);
});
