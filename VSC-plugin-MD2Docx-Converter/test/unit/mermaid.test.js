const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const {
    parseMermaidBlocks,
    encodeMermaidPako,
    isPngImage,
    validateMermaidApiUrl,
    renderMermaidWithRetry,
    MERMAID_BLOCK_REGEX,
    MERMAID_MAX_ATTEMPTS,
    MERMAID_RETRY_DELAYS_MS,
    findMermaidBlockAtPosition,
    mapWithConcurrency,
    normalizeMermaidOutputFormat,
    createMermaidFileName
} = require('../../out/mermaid.js');

// The retry helper rejects anything that is not a PNG, so a successful render
// has to return real PNG bytes rather than the literal text "png".
const PNG_FIXTURE = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('png')
]);

test('parseMermaidBlocks finds a single block', () => {
    const blocks = parseMermaidBlocks('# Title\n\n```mermaid\ngraph TD; A-->B\n```\n\nafter');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].code, 'graph TD; A-->B');
    assert.ok(blocks[0].start >= 0);
    assert.ok(blocks[0].end > blocks[0].start);
});

test('parseMermaidBlocks finds multiple blocks', () => {
    const blocks = parseMermaidBlocks('```mermaid\nA\n```\ntext\n```mermaid\nB\n```');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].code, 'A');
    assert.equal(blocks[1].code, 'B');
});

test('parseMermaidBlocks returns nothing when there is no mermaid fence', () => {
    assert.deepEqual(parseMermaidBlocks('# Title\n\n```js\nconsole.log(1)\n```'), []);
});

test('parseMermaidBlocks keeps inline code inside the body', () => {
    const blocks = parseMermaidBlocks('```mermaid\ngraph TD; A["`x`"]-->B\n```');
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].code.includes('A["`x`"]'));
});

test('parseMermaidBlocks ignores a fence that is not at the start of a line', () => {
    assert.deepEqual(parseMermaidBlocks('text ```mermaid\nA\n```'), []);
});

test('parseMermaidBlocks accepts a tilde fence', () => {
    const blocks = parseMermaidBlocks('~~~mermaid\ngraph TD\n~~~');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].code, 'graph TD');
});

test('parseMermaidBlocks accepts an indented fence of up to three spaces', () => {
    const blocks = parseMermaidBlocks('   ```mermaid\ngraph TD\n   ```');
    assert.equal(blocks.length, 1);
});

test('parseMermaidBlocks leaves a four-space indented block alone', () => {
    assert.deepEqual(parseMermaidBlocks('    ```mermaid\n    graph TD\n    ```'), []);
});

test('parseMermaidBlocks accepts CRLF line endings', () => {
    const blocks = parseMermaidBlocks('```mermaid\r\ngraph TD\r\n```');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].code, 'graph TD');
});

test('parseMermaidBlocks requires the info string to be exactly mermaid', () => {
    assert.deepEqual(parseMermaidBlocks('```mermaidjs\ngraph TD\n```'), []);
});

test('parseMermaidBlocks requires the closing fence to match the opening one', () => {
    assert.deepEqual(parseMermaidBlocks('```mermaid\ngraph TD\n~~~\n'), []);
});

test('parseMermaidBlocks spans the block it reports', () => {
    const markdown = 'before\n```mermaid\ngraph TD\n```\nafter';
    const [block] = parseMermaidBlocks(markdown);
    assert.equal(markdown.slice(block.start, block.end), '```mermaid\ngraph TD\n```');
});

test('encodeMermaidPako round-trips through inflate', () => {
    const encoded = encodeMermaidPako('graph TD; A-->B');
    assert.ok(!encoded.includes('='), 'base64url must be unpadded');
    assert.ok(!encoded.includes('+') && !encoded.includes('/'), 'must be base64url');
    const json = zlib.inflateSync(Buffer.from(encoded, 'base64url')).toString('utf8');
    assert.deepEqual(JSON.parse(json), { code: 'graph TD; A-->B' });
});

test('encodeMermaidPako matches the Dify plugin payload format', () => {
    // Python: zlib.compress(json.dumps({"code": code}, separators=(",", ":")).encode(), 9)
    const encoded = encodeMermaidPako('graph TD; A-->B');
    const raw = Buffer.from(encoded, 'base64url');
    assert.equal(raw[0], 0x78, 'must be a zlib stream');
    const json = zlib.inflateSync(raw).toString('utf8');
    assert.equal(json, '{"code":"graph TD; A-->B"}', 'must match Python json.dumps separators');
});

test('isPngImage recognises the PNG signature', () => {
    assert.equal(isPngImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
    assert.equal(isPngImage(Buffer.from('<html>not a png</html>')), false);
    assert.equal(isPngImage(Buffer.alloc(0)), false);
});

test('validateMermaidApiUrl accepts http and https', () => {
    assert.equal(validateMermaidApiUrl('https://mermaid.ink'), 'https://mermaid.ink');
    assert.equal(validateMermaidApiUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
});

test('validateMermaidApiUrl rejects anything else', () => {
    assert.throws(() => validateMermaidApiUrl('ftp://mermaid.ink'));
    assert.throws(() => validateMermaidApiUrl('mermaid.ink'));
    assert.throws(() => validateMermaidApiUrl('https://mermaid.ink?x=1'));
    assert.throws(() => validateMermaidApiUrl('https://mermaid.ink#frag'));
});

test('the block regex is anchored to line starts', () => {
    assert.ok(MERMAID_BLOCK_REGEX.flags.includes('m'));
    assert.ok(MERMAID_BLOCK_REGEX.flags.includes('g'));
});

test('renderMermaidWithRetry succeeds on a later attempt', async () => {
    let calls = 0;
    const options = {
        apiUrl: 'https://mermaid.ink',
        retryDelaysMs: [0, 0],
        fetchImage: async () => {
            calls += 1;
            if (calls < 3) {
                throw new Error('boom');
            }
            return PNG_FIXTURE;
        }
    };
    const image = await renderMermaidWithRetry('graph TD', options);
    assert.ok(image.equals(PNG_FIXTURE));
    assert.equal(calls, 3);
});

test('renderMermaidWithRetry gives up after the attempt limit', async () => {
    let calls = 0;
    const options = {
        apiUrl: 'https://mermaid.ink',
        maxAttempts: 2,
        retryDelaysMs: [0],
        fetchImage: async () => {
            calls += 1;
            throw new Error('boom');
        }
    };
    await assert.rejects(() => renderMermaidWithRetry('graph TD', options), /boom/);
    assert.equal(calls, 2);
});

test('renderMermaidWithRetry stops when the shared budget is exhausted', async () => {
    let calls = 0;
    const options = {
        apiUrl: 'https://mermaid.ink',
        maxAttempts: 5,
        retryDelaysMs: [50],
        totalBudgetMs: 60,
        fetchImage: async () => {
            calls += 1;
            throw new Error('boom');
        }
    };
    await assert.rejects(() => renderMermaidWithRetry('graph TD', options), /boom/);
    assert.ok(calls < 5, `must stop early, made ${calls} attempts`);
});

test('renderMermaidWithRetry rejects a response that is not a PNG', async () => {
    const options = {
        apiUrl: 'https://mermaid.ink',
        maxAttempts: 1,
        fetchImage: async () => Buffer.from('<html>502 Bad Gateway</html>')
    };
    await assert.rejects(() => renderMermaidWithRetry('graph TD', options), /PNG/);
});

test('the retry defaults match the Dify plugin', () => {
    assert.equal(MERMAID_MAX_ATTEMPTS, 3);
    assert.deepEqual(MERMAID_RETRY_DELAYS_MS, [1000, 2000]);
});

test('findMermaidBlockAtPosition locates the block under the cursor', () => {
    const text = 'intro\n```mermaid\ngraph TD; A-->B\n```\ntail';
    const start = text.indexOf('```mermaid');
    const found = findMermaidBlockAtPosition(text, start + 3);
    assert.ok(found);
    assert.equal(found.code, 'graph TD; A-->B');
});

test('findMermaidBlockAtPosition returns undefined outside a block', () => {
    assert.equal(findMermaidBlockAtPosition('# Title\n\ntext', 3), undefined);
});

test('findMermaidBlockAtPosition finds the block on every call', () => {
    // MERMAID_BLOCK_REGEX carries the global flag, so a shared instance would
    // continue from the previous lastIndex and miss the block the second time.
    const text = 'intro\n```mermaid\ngraph TD\n```\ntail';
    const start = text.indexOf('```mermaid');
    assert.ok(findMermaidBlockAtPosition(text, start));
    assert.ok(findMermaidBlockAtPosition(text, start));
});

test('findMermaidBlockAtPosition reports the block range', () => {
    const text = 'intro\n```mermaid\ngraph TD\n```\ntail';
    const start = text.indexOf('```mermaid');
    const found = findMermaidBlockAtPosition(text, start);
    assert.equal(found.start, start);
    assert.equal(text.slice(found.start, found.end), '```mermaid\ngraph TD\n```');
});

test('a failing worker stops the remaining work', async () => {
    const started = [];

    await assert.rejects(
        mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
            started.push(item);
            if (item === 1) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                throw new Error('boom');
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
            return item;
        })
    );

    // The worker that is still running has to finish before the rejection
    // surfaces — otherwise it keeps rendering in the background.
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.deepEqual(started, [1, 2], 'no further items may be handed out after a failure');
});

test('the rejection waits for the running workers', async () => {
    const startedAt = Date.now();

    await assert.rejects(
        mapWithConcurrency([1, 2], 2, async (item) => {
            if (item === 1) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                throw new Error('boom');
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
            return item;
        })
    );

    assert.ok(
        Date.now() - startedAt >= 200,
        'the rejection must wait for the workers that are still running'
    );
});

test('normalizeMermaidOutputFormat only accepts png and svg', () => {
    assert.equal(normalizeMermaidOutputFormat('svg'), 'svg');
    assert.equal(normalizeMermaidOutputFormat('png'), 'png');
    // Anything else falls back to the safe default: the value ends up in a
    // file name and in a command line.
    assert.equal(normalizeMermaidOutputFormat('png & calc.exe'), 'png');
    assert.equal(normalizeMermaidOutputFormat('../../escaped'), 'png');
    assert.equal(normalizeMermaidOutputFormat(''), 'png');
    assert.equal(normalizeMermaidOutputFormat(undefined), 'png');
    assert.equal(normalizeMermaidOutputFormat(42), 'png');
    assert.equal(normalizeMermaidOutputFormat(null), 'png');
});

test('Mermaid image names do not collide within one millisecond', () => {
    const now = new Date('2026-11-17T10:00:00.123Z');
    const first = createMermaidFileName(now, 'png');
    const second = createMermaidFileName(now, 'png');
    assert.notEqual(first, second);
    assert.match(first, /^mermaid-\d{8}-\d{6}-\d{3}-\d+-[0-9a-f]{8}\.png$/);
    assert.match(second, /^mermaid-\d{8}-\d{6}-\d{3}-\d+-[0-9a-f]{8}\.png$/);
});
