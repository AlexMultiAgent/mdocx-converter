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
    MERMAID_RETRY_DELAYS_MS
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
