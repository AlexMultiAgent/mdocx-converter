'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { execExecutable, escapeCmdArgument, buildCmdCommandLine } = require('../../out/process.js');
const { CancellationTokenSource, makeTempDir } = require('./support/vscode-stub.js');
const {
    createExtensionContext,
    createVscodeStub,
    loadExtension,
    withTimeout
} = require('./support/vscode-stub.js');

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

test('a timed executable probe is killed instead of hanging', async () => {
    const source = new CancellationTokenSource();
    const script = 'setTimeout(() => {}, 30000);';
    const running = execExecutable(NODE, ['-e', script], {
        shell: false,
        token: source.token,
        timeoutMs: 200
    });

    try {
        await assert.rejects(withTimeout(running, 2000, 'probe timeout'), (error) => {
            assert.equal(error.code, 'ETIMEDOUT');
            return true;
        });
    } finally {
        source.cancel();
        await running.catch(() => undefined);
    }
});

test('cancelling an export stops an executable probe', async () => {
    const source = new CancellationTokenSource();
    const stub = createVscodeStub();
    const extension = loadExtension(stub);
    extension.activate(createExtensionContext());

    const running = extension.resolveExecutable(
        [NODE],
        ['-e', 'setTimeout(() => {}, 2000);'],
        source.token
    );
    setTimeout(() => source.cancel(), 100);

    try {
        await assert.rejects(withTimeout(running, 3000, 'probe cancellation'), (error) => {
            assert.equal(error.name, 'ProcessCancelledError');
            return true;
        });
    } finally {
        source.cancel();
        await running.catch(() => undefined);
    }
});

test('the working directory is honoured', async () => {
    const cwd = path.join(__dirname, '..', '..');
    const { stdout } = await execExecutable(NODE, ['-e', 'process.stdout.write(process.cwd())'], {
        shell: false,
        cwd
    });

    const actual = path.resolve(stdout.trim());
    const expected = path.resolve(cwd);
    // Windows reports the drive letter in the case it was given.
    const same = process.platform === 'win32'
        ? actual.toLowerCase() === expected.toLowerCase()
        : actual === expected;

    assert.ok(same, `the child has to run in ${expected}, not in ${actual}`);
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

test('a line break in an argument cannot run a second command', { skip: process.platform !== 'win32' }, async (t) => {
    const dir = makeTempDir('mdocx-newline-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const { cmd } = writeArgumentRecorder(dir);
    const marker = path.join(dir, 'INJECTED.txt');

    for (const payload of [
        `x\nnode -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')"`,
        `x\r\nnode -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')"`
    ]) {
        await execExecutable(cmd, ['--flag', payload], { shell: true }).catch(() => undefined);

        assert.equal(
            fs.existsSync(marker),
            false,
            'a line break in an argument must not run a second command'
        );
    }
});

test('a command whose path contains spaces still works', { skip: process.platform !== 'win32' }, async (t) => {
    const dir = makeTempDir('mdocx-space-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    // A directory with a space in its name — the command path itself has to
    // survive the quoting.
    const spaced = path.join(dir, 'a folder with spaces');
    fs.mkdirSync(spaced);

    const recordFile = path.join(spaced, 'argv.json');
    const helper = path.join(spaced, 'record.js');
    fs.writeFileSync(
        helper,
        `const fs = require('fs');\nfs.writeFileSync(${JSON.stringify(recordFile)}, JSON.stringify(process.argv.slice(2)));\n`,
        'utf8'
    );
    const cmd = path.join(spaced, 'record.cmd');
    fs.writeFileSync(cmd, `@echo off\r\nnode "${helper}" %*\r\n`, 'utf8');

    await execExecutable(cmd, ['--flag', 'a b c', 'x & y'], { shell: true });

    const received = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    assert.deepEqual(received, ['--flag', 'a b c', 'x & y']);
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

/**
 * The escaped form of an argument, as the command processor reads it.
 *
 * A quote of the argument becomes `""`, which the command processor reads as
 * one literal quote and which keeps the quoted region open. A `\"` would end
 * the region instead, and the metacharacters behind it would leave the
 * region — a payload like `x" & calc` would then run `calc` as a second
 * command.
 */
const ESCAPED_ARGUMENTS = [
    ['plain.txt', 'plain.txt'],
    ['a & b', '^"a^ ^&^ b^"'],
    ['a b c', '^"a^ b^ c^"'],
    ['', '^"^"'],
    ['a "quoted" b', '^"a^ ^"^"quoted^"^"^ b^"'],
    ['x" & calc', '^"x^"^"^ ^&^ calc^"'],
    ['x"', '^"x^"^"^"'],
    ['trailing\\', 'trailing\\'],
    ['C:\\Users\\Test & Co\\file.txt', '^"C:\\Users\\Test^ ^&^ Co\\file.txt^"'],
    ['a\\"b', '^"a\\\\^"^"b^"'],
    ['a%PATH% b', '^"a^%PATH^%^ b^"']
];

test('an argument is escaped so that it cannot end the quoted region', () => {
    for (const [argument, expected] of ESCAPED_ARGUMENTS) {
        assert.equal(
            escapeCmdArgument(argument),
            expected,
            `the argument ${JSON.stringify(argument)} must be escaped as ${JSON.stringify(expected)}`
        );
    }
});

test('the command line is built from the escaped parts', () => {
    const line = buildCmdCommandLine('C:\\Program Files\\pandoc.cmd', ['--metadata', 'title=x" & calc']);

    assert.equal(
        line,
        '"^"C:\\Program^ Files\\pandoc.cmd^" --metadata ^"title=x^"^"^ ^&^ calc^""',
        `the command line must hold the escaped parts: ${line}`
    );
});

test('a long run of backslashes does not slow the escaping down', () => {
    // The old implementation used two regular expressions that had to
    // backtrack over every backslash, which made the escaping quadratic:
    // 200 000 backslashes took a minute. The scan has to stay linear.
    const argument = '\\'.repeat(200000) + '&';

    const started = process.hrtime.bigint();
    const escaped = escapeCmdArgument(argument);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    assert.ok(
        escaped.startsWith('^"' + '\\'.repeat(200000)),
        'the run of backslashes has to survive'
    );
    assert.ok(
        escaped.endsWith('^&^"'),
        `the metacharacter has to be escaped: ${escaped.slice(-8)}`
    );
    assert.ok(
        elapsedMs < 15000,
        `the escaping of 200 000 backslashes took ${elapsedMs.toFixed(0)}ms, it has to be linear`
    );
});

test('a quote in an argument cannot run a second command', { skip: process.platform !== 'win32' }, async (t) => {
    const dir = makeTempDir('mdocx-quote-');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const { cmd, recordFile } = writeArgumentRecorder(dir);

    // The second command is a batch file of its own, so that the payload
    // needs no quotes of its own to run it.
    const marker = path.join(dir, 'INJECTED.txt');
    const boom = path.join(dir, 'boom.cmd');
    fs.writeFileSync(boom, `@echo off\r\ntype nul > "${marker}"\r\n`, 'utf8');

    // The quote of the payload would end the quoted region of the argument,
    // and the `&` behind it would then start a second command.
    const payload = `x" & ${boom} & "y`;

    await execExecutable(cmd, ['--flag', payload], { shell: true });

    assert.equal(
        fs.existsSync(marker),
        false,
        'a quote in an argument must not run a second command'
    );

    const received = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    assert.deepEqual(
        received,
        ['--flag', payload],
        `the argument must arrive unchanged: ${JSON.stringify(received)}`
    );
});
