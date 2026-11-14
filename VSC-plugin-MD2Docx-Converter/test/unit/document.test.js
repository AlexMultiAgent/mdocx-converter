const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDocumentTitle, resolveDocumentTitle, sanitizeFileName } = require('../../out/document.js');

test('extractDocumentTitle returns the first ATX heading', () => {
    assert.equal(extractDocumentTitle('# 标题\n\n正文'), '标题');
    assert.equal(extractDocumentTitle('前言\n\n# 第二段里的 H1'), '第二段里的 H1');
});

test('extractDocumentTitle strips trailing hashes and whitespace', () => {
    assert.equal(extractDocumentTitle('##   Spaced Title   ##'), 'Spaced Title');
});

test('extractDocumentTitle ignores setext headings', () => {
    assert.equal(extractDocumentTitle('Setext\n======\n'), undefined);
});

test('extractDocumentTitle accepts any ATX heading level', () => {
    assert.equal(extractDocumentTitle('## 只有二级标题'), '只有二级标题');
    assert.equal(extractDocumentTitle('### 三级标题'), '三级标题');
});

test('extractDocumentTitle ignores seven or more hashes', () => {
    assert.equal(extractDocumentTitle('####### 不是标题'), undefined);
});

test('resolveDocumentTitle prefers the configured title', () => {
    assert.equal(resolveDocumentTitle('# From H1', 'Configured', '/tmp/a.md'), 'Configured');
});

test('resolveDocumentTitle falls back to the heading then the filename', () => {
    assert.equal(resolveDocumentTitle('# From H1', '', '/tmp/a.md'), 'From H1');
    assert.equal(resolveDocumentTitle('no heading', '', '/tmp/report.md'), 'report');
});

test('sanitizeFileName replaces illegal characters', () => {
    assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
    assert.equal(sanitizeFileName('   '), 'document');
    assert.equal(sanitizeFileName('正常文件名'), '正常文件名');
});

test('extractDocumentTitle ignores headings inside fenced code blocks', () => {
    assert.equal(extractDocumentTitle('```bash\n# Install the thing\nnpm i\n```'), undefined);
    assert.equal(extractDocumentTitle('```\n# not a title\n```\n\n# Real Title'), 'Real Title');
});

test('resolveDocumentTitle handles Windows paths', () => {
    assert.equal(resolveDocumentTitle('no heading', '', 'C:\\dir\\report.md'), 'report');
    assert.equal(resolveDocumentTitle('no heading', '', 'C:/dir/report.md'), 'report');
});
