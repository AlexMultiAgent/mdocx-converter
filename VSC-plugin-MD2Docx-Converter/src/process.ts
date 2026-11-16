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
 * Terminate a child process and everything it started.
 *
 * `child.kill()` only reaches the direct child. On Windows that child is
 * `cmd.exe` when a `.cmd` runs, and the program doing the real work is a
 * grandchild that survives — and keeps the inherited stdout pipe open, so
 * the 'close' event never arrives and the export hangs. `taskkill /T` takes
 * the whole tree down.
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

    child.kill();
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
        const child = spawn(command, args, {
            cwd: options.cwd,
            shell: options.shell !== undefined ? options.shell : shouldRunThroughShell(command),
            windowsHide: options.windowsHide ?? true
        });

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

        child.on('error', (error) => {
            if (settled) {
                return;
            }

            settled = true;
            cancellation?.dispose();
            reject(error);
        });

        child.on('close', (code, signal) => {
            if (settled) {
                return;
            }

            settled = true;
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
