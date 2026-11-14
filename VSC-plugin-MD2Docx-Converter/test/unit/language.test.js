const test = require('node:test');
const assert = require('node:assert/strict');
const { detectMarkdownLanguage, resolveReferenceLanguage } = require('../../out/language.js');

test('detectMarkdownLanguage picks chinese for CJK-heavy text', () => {
    assert.equal(detectMarkdownLanguage('这是一段完全由中文构成的文本。'.repeat(20)), 'chinese');
});

test('detectMarkdownLanguage picks english for latin text', () => {
    assert.equal(detectMarkdownLanguage('This is a plain english paragraph about nothing.'.repeat(20)), 'english');
});

test('detectMarkdownLanguage picks chinese at the 40-character threshold', () => {
    assert.equal(detectMarkdownLanguage('中'.repeat(40)), 'chinese');
    assert.equal(detectMarkdownLanguage('中'.repeat(39) + 'a'.repeat(300)), 'english');
});

test('detectMarkdownLanguage picks chinese below the threshold when there is no latin text', () => {
    // The detection rule is "CJK count >= 40 OR CJK count > 15% of the latin count".
    // With zero latin characters the ratio clause is already satisfied, so a
    // Chinese-only text stays chinese even below the 40-character threshold.
    assert.equal(detectMarkdownLanguage('中'.repeat(39)), 'chinese');
});

test('detectMarkdownLanguage falls back to english for empty text', () => {
    assert.equal(detectMarkdownLanguage(''), 'english');
});

test('resolveReferenceLanguage honours an explicit setting', () => {
    assert.equal(resolveReferenceLanguage('中文内容'.repeat(50), 'english'), 'english');
    assert.equal(resolveReferenceLanguage('plain english', 'chinese'), 'chinese');
    assert.equal(resolveReferenceLanguage('中文内容'.repeat(50), 'auto'), 'chinese');
});
