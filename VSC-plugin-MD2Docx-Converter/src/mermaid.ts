import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';

/**
 * Mermaid fence detection.
 *
 * The rules mirror the Dify plugin's `MERMAID_BLOCK_RE`:
 *
 * ```python
 * MERMAID_BLOCK_RE = re.compile(
 *     r"(?ms)^[ \t]{0,3}(?P<fence>```+|~~~+)[ \t]*mermaid[ \t]*\r?\n"
 *     r"(?P<body>.*?)"
 *     r"^[ \t]{0,3}(?P=fence)[ \t]*\r?$"
 * )
 * ```
 *
 * Line by line: at most three leading spaces (four or more makes it an
 * indented code block, not a fence), both ``` and ~~~ fences, an info string
 * that is exactly `mermaid`, and a closing fence made of the same character
 * as the opening one.
 *
 * The old VS Code regular expression (`/```mermaid[^\n]*\r?\n([\s\S]*?)```/gi`)
 * had two defects: tilde-fenced diagrams were never rendered, and `[^\n]*`
 * also matched ```` ```mermaidjs ```` as a Mermaid diagram.
 *
 * One deliberate difference: the Dify `body` group *includes* the trailing
 * newline (`"graph TD\n"`), this capture group does not (`"graph TD"`) — the
 * `\r?\n` in front of the closing fence sits outside the group. It makes no
 * difference for rendering, but the VS Code side writes the original code
 * block back when a diagram fails to render, and one newline fewer is cleaner.
 *
 * Capture group 1 is the fence itself (the closing fence is a backreference
 * to it), capture group 2 is the diagram body.
 */
export const MERMAID_BLOCK_REGEX = /^[ \t]{0,3}(```+|~~~+)[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n^[ \t]{0,3}\1[ \t]*\r?$/gim;

export const MERMAID_REQUEST_TIMEOUT_MS = 30_000;
export const MERMAID_MAX_ATTEMPTS = 3;
export const MERMAID_RETRY_DELAYS_MS = [1000, 2000];
export const MERMAID_TOTAL_BUDGET_MS = 120_000;

/** Largest response the client is willing to buffer. */
export const MERMAID_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface MermaidBlock {
    code: string;
    start: number;
    end: number;
}

export interface MermaidRenderOptions {
    apiUrl: string;
    timeoutMs?: number;
    maxAttempts?: number;
    retryDelaysMs?: number[];
    totalBudgetMs?: number;
    /** Overrides the HTTP transport. Injected by the tests. */
    fetchImage?: (url: string, timeoutMs: number) => Promise<Buffer>;
}

export function parseMermaidBlocks(markdownText: string): MermaidBlock[] {
    const blocks: MermaidBlock[] = [];
    const regex = new RegExp(MERMAID_BLOCK_REGEX.source, MERMAID_BLOCK_REGEX.flags);

    let match = regex.exec(markdownText);
    while (match) {
        blocks.push({
            // Group 1 is the fence, group 2 is the diagram body.
            code: match[2],
            start: match.index,
            end: match.index + match[0].length
        });
        match = regex.exec(markdownText);
    }

    return blocks;
}

/**
 * Encode a diagram the way Mermaid Ink's `pako:` endpoint expects it.
 *
 * The payload is `{"code": ...}` JSON, deflated with zlib at level 9 and
 * base64url-encoded without padding — the same format the Mermaid Live
 * Editor produces for its share URLs.
 *
 * The compressed bytes are not byte-identical to Python's `zlib.compress`
 * (the two zlib builds differ), but both sides produce a valid zlib stream
 * that the other one inflates back to the same JSON, which is all the
 * service needs.
 */
export function encodeMermaidPako(diagram: string): string {
    const payload = JSON.stringify({ code: diagram });
    return zlib.deflateSync(Buffer.from(payload, 'utf8'), { level: 9 }).toString('base64url');
}

/** True when the bytes start with the PNG file signature. */
export function isPngImage(data: Buffer): boolean {
    return data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/**
 * Validate the configured Mermaid Ink base URL.
 *
 * The Dify plugin additionally refuses link-local targets and hostnames that
 * resolve to them, because its URL arrives as an LLM-supplied tool parameter.
 * Here the URL comes from the user's own settings, so only the cheap
 * structural checks are worth doing.
 */
export function validateMermaidApiUrl(apiUrl: string): string {
    const candidate = apiUrl.trim();
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        throw new Error(`Invalid Mermaid Ink URL: ${apiUrl}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`The Mermaid Ink URL must use http or https, got ${parsed.protocol}`);
    }
    if (!parsed.hostname) {
        throw new Error('The Mermaid Ink URL must include a host name');
    }
    if (parsed.search) {
        throw new Error('The Mermaid Ink URL must not contain a query string');
    }
    if (parsed.hash) {
        throw new Error('The Mermaid Ink URL must not contain a fragment');
    }

    return candidate;
}

function httpGet(url: string, timeoutMs: number): Promise<Buffer> {
    const transport = url.startsWith('http://') ? http : https;

    return new Promise<Buffer>((resolve, reject) => {
        const request = transport.get(url, { headers: { 'User-Agent': 'mdocx-converter' } }, (response) => {
            const status = response.statusCode ?? 0;

            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                reject(new Error(`Mermaid Ink redirected to ${response.headers.location}`));
                return;
            }

            if (status !== 200) {
                response.resume();
                reject(new Error(`Mermaid Ink returned HTTP ${status}`));
                return;
            }

            const chunks: Buffer[] = [];
            let total = 0;
            response.on('data', (chunk: Buffer) => {
                total += chunk.length;
                if (total > MERMAID_MAX_RESPONSE_BYTES) {
                    response.destroy();
                    reject(new Error(`Mermaid Ink response exceeded ${MERMAID_MAX_RESPONSE_BYTES} bytes`));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Mermaid Ink request timed out after ${timeoutMs}ms`));
        });

        request.on('error', reject);
    });
}

export function renderMermaidViaInk(diagram: string, options: MermaidRenderOptions): Promise<Buffer> {
    const timeoutMs = options.timeoutMs ?? MERMAID_REQUEST_TIMEOUT_MS;
    const baseUrl = options.apiUrl.replace(/\/+$/, '');
    // `type=png` asks the service for a PNG explicitly; without it the
    // response format depends on the service's Accept handling.
    const url = `${baseUrl}/img/pako:${encodeMermaidPako(diagram)}?type=png`;

    return options.fetchImage
        ? options.fetchImage(url, timeoutMs)
        : httpGet(url, timeoutMs);
}

/**
 * Render a diagram through Mermaid Ink, retrying transient failures.
 *
 * The total budget is shared by every diagram of one export: the caller
 * passes the time that is left, so ten diagrams cannot each burn the full
 * default budget.
 */
export async function renderMermaidWithRetry(
    diagram: string,
    options: MermaidRenderOptions
): Promise<Buffer> {
    const maxAttempts = options.maxAttempts ?? MERMAID_MAX_ATTEMPTS;
    const retryDelays = options.retryDelaysMs ?? MERMAID_RETRY_DELAYS_MS;
    const deadline = Date.now() + (options.totalBudgetMs ?? MERMAID_TOTAL_BUDGET_MS);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const image = await renderMermaidViaInk(diagram, options);
            if (!isPngImage(image)) {
                throw new Error('Mermaid Ink returned a response that is not a PNG');
            }
            return image;
        } catch (error) {
            lastError = error;
            if (attempt >= maxAttempts) {
                break;
            }

            const delay = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
            if (Date.now() + delay >= deadline) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}
