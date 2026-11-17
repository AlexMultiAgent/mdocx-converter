import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { StringDecoder } from 'string_decoder';

/** The default cap on the collected stdout and stderr, in bytes. */
export const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

export interface ProcessResult {
    stdout: string;
    stderr: string;
}

/**
 * The process was stopped because the user cancelled the export.
 *
 * The error says the process was cancelled on purpose — a process that
 * failed on its own keeps its own diagnostic, even when the token happens to
 * be cancelled at the same moment.
 */
export class ProcessCancelledError extends Error {
    constructor() {
        super('The process was cancelled.');
        this.name = 'ProcessCancelledError';
    }
}

/** The process exceeded the caller's deadline and its tree was terminated. */
export class ProcessTimedOutError extends Error {
    readonly code = 'ETIMEDOUT';

    constructor(timeoutMs: number) {
        super(`The process did not finish within ${timeoutMs}ms.`);
        this.name = 'ProcessTimedOutError';
    }
}

/** The part of `vscode.CancellationToken` the process layer needs. */
export interface CancellableToken {
    readonly isCancellationRequested: boolean;
    onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface ExecOptions {
    cwd?: string;
    shell?: boolean;
    windowsHide?: boolean;
    maxBuffer?: number;
    timeoutMs?: number;
    token?: CancellableToken;
}

export interface ProcessError extends Error {
    code?: string | number;
    signal?: NodeJS.Signals | null;
    killed?: boolean;
    stdout?: string;
    stderr?: string;
}

/**
 * Whether the command has to go through a shell.
 *
 * Windows cannot execute a `.cmd` or a `.bat` directly — the command
 * processor has to run it, so the shell becomes the direct child and the real
 * program turns into a grandchild.
 */
export function shouldRunThroughShell(command: string): boolean {
    return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

/**
 * The characters `cmd.exe` reads as syntax rather than as text.
 *
 * The whitespace controls belong here as well: a line break or a tab ends
 * the argument for the command processor, so the argument would arrive in
 * pieces.
 */
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?\t\r\n])/g;

/** The same list, without the global flag — `test` must not be stateful. */
const CMD_META_CHAR = /[()\][%!^"`<>&|;, *?\t\r\n]/;

/**
 * Escape one argument for `cmd.exe`.
 *
 * An argument that the command processor reads as plain text is passed on
 * unchanged: quoting it would change what a batch file sees in `%1`. An
 * argument that carries a metacharacter is wrapped in double quotes, so that
 * the spaces and the operators inside it stay text, and every metacharacter
 * gets a caret in front of it, so that nothing escapes the quotes. The
 * quotes inside the argument are escaped for the C runtime of the program
 * that receives them, and the backslashes in front of them are doubled.
 */
function escapeCmdArgument(argument: string): string {
    if (argument.length > 0 && !CMD_META_CHAR.test(argument)) {
        return argument;
    }

    const escaped = argument
        .replace(/(\\*)"/g, '$1$1\\"')
        .replace(/(\\*)$/, '$1$1');

    return `"${escaped}"`.replace(CMD_META_CHARS, '^$1');
}

/** Escape one argument for a POSIX shell. */
function escapePosixArgument(argument: string): string {
    return `'${argument.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the command line for `cmd.exe`.
 *
 * The `/s` switch tells the command processor to strip the outermost quotes,
 * so the whole line is wrapped in one more pair.
 */
function buildCmdCommandLine(command: string, args: string[]): string {
    const parts = [escapeCmdArgument(command), ...args.map(escapeCmdArgument)];
    return `"${parts.join(' ')}"`;
}

/**
 * Start the child process.
 *
 * Node's own shell mode concatenates the arguments without escaping them, so
 * a metacharacter in a path would run a second command. The command line is
 * therefore built here, with every argument escaped for the shell that runs
 * it.
 */
function spawnChild(
    command: string,
    args: string[],
    options: ExecOptions,
    useShell: boolean
): ChildProcess {
    // On POSIX the child leads its own process group, so that a cancellation
    // can take down the whole tree and not only the direct child.
    const detached = process.platform !== 'win32';

    if (!useShell) {
        return spawn(command, args, {
            cwd: options.cwd,
            windowsHide: options.windowsHide ?? true,
            detached
        });
    }

    if (process.platform === 'win32') {
        return spawn(process.env.comspec || 'cmd.exe', ['/d', '/s', '/c', buildCmdCommandLine(command, args)], {
            cwd: options.cwd,
            windowsHide: options.windowsHide ?? true,
            windowsVerbatimArguments: true
        });
    }

    const line = [command, ...args].map(escapePosixArgument).join(' ');
    return spawn('/bin/sh', ['-c', line], {
        cwd: options.cwd,
        windowsHide: options.windowsHide ?? true,
        detached
    });
}

/**
 * Terminate a child process and everything it started.
 *
 * `child.kill()` only reaches the direct child. On Windows that child is
 * `cmd.exe` when a `.cmd` runs, and the program doing the real work is a
 * grandchild that survives — and keeps the inherited stdout pipe open, so
 * the 'close' event never arrives and the export hangs. `taskkill /T` takes
 * the whole tree down.
 *
 * On POSIX the child leads its own process group, so the whole group is
 * signalled at once.
 */
export function killProcessTree(child: ChildProcess): void {
    if (process.platform === 'win32' && child.pid !== undefined) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
        });
        killer.on('error', () => {
            child.kill();
        });
        killer.on('exit', (code) => {
            if (code !== 0) {
                child.kill();
            }
        });
        return;
    }

    if (child.pid !== undefined) {
        try {
            process.kill(-child.pid, 'SIGTERM');
            escalateToKill(child);
            return;
        } catch {
            // The group is gone, or the child does not lead one.
        }
    }

    child.kill();
}

/**
 * Make sure a process that ignores SIGTERM still goes away.
 */
function escalateToKill(child: ChildProcess): void {
    const timer = setTimeout(() => {
        try {
            if (child.pid !== undefined) {
                process.kill(-child.pid, 'SIGKILL');
            }
        } catch {
            // The group is already gone.
        }
    }, 2000);

    // The timer must not keep the extension host alive.
    (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * Run a child process and collect its output.
 *
 * The rejected error carries `stdout` and `stderr`, because the caller
 * pattern-matches pandoc's own diagnostics to tell the user what went wrong.
 */
export function execExecutable(
    command: string,
    args: string[],
    options: ExecOptions = {}
): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const useShell = options.shell !== undefined ? options.shell : shouldRunThroughShell(command);
        const child = spawnChild(command, args, options, useShell);

        const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;

        // A `StringDecoder` carries an incomplete multi-byte sequence over to
        // the next chunk; decoding every chunk on its own would turn a split
        // CJK character into U+FFFD.
        const stdoutDecoder = new StringDecoder('utf8');
        const stderrDecoder = new StringDecoder('utf8');

        let stdout = '';
        let stderr = '';
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        let limitError: ProcessError | undefined;
        let cancelled = false;
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        const collect = (which: 'stdout' | 'stderr', chunk: Buffer): void => {
            if (limitError) {
                return;
            }

            if (which === 'stdout') {
                stdoutBytes += chunk.length;
                if (stdoutBytes > maxBuffer) {
                    limitError = createLimitError('stdout');
                    killProcessTree(child);
                    return;
                }
                stdout += stdoutDecoder.write(chunk);
                return;
            }

            stderrBytes += chunk.length;
            if (stderrBytes > maxBuffer) {
                limitError = createLimitError('stderr');
                killProcessTree(child);
                return;
            }
            stderr += stderrDecoder.write(chunk);
        };

        child.stdout?.on('data', (chunk: Buffer) => collect('stdout', chunk));
        child.stderr?.on('data', (chunk: Buffer) => collect('stderr', chunk));

        const cancellation = options.token?.onCancellationRequested(() => {
            cancelled = true;
            killProcessTree(child);
        });

        if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
            timeoutHandle = setTimeout(() => {
                timedOut = true;
                killProcessTree(child);
            }, options.timeoutMs);
            timeoutHandle.unref();
        }

        const clearDeadline = (): void => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = undefined;
            }
        };

        child.on('error', (error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearDeadline();
            cancellation?.dispose();
            reject(error);
        });

        child.on('close', (code, signal) => {
            if (settled) {
                return;
            }

            settled = true;
            clearDeadline();
            cancellation?.dispose();

            if (!limitError) {
                stdout += stdoutDecoder.end();
                stderr += stderrDecoder.end();
            }

            if (limitError) {
                limitError.stdout = stdout;
                limitError.stderr = stderr;
                reject(limitError);
                return;
            }

            if (timedOut) {
                const error = new ProcessTimedOutError(options.timeoutMs ?? 0) as ProcessError;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }

            if (cancelled) {
                const error = new ProcessCancelledError() as ProcessError;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }

            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }

            const detail = signal ? `signal ${signal}` : `code ${code}`;
            const error = new Error(`Process exited with ${detail}`) as ProcessError;
            error.code = code ?? undefined;
            error.signal = signal;
            error.killed = child.killed;
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
        });
    });
}

function createLimitError(which: 'stdout' | 'stderr'): ProcessError {
    const error = new Error(`${which} maxBuffer length exceeded`) as ProcessError;
    error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    error.stdout = '';
    error.stderr = '';
    return error;
}
