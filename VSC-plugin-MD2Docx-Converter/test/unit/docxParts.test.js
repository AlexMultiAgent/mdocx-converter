const test = require('node:test');
const assert = require('node:assert/strict');
const AdmZip = require('adm-zip');

const { findDocxPart } = require('../../out/docxParts.js');

const BACKSLASH = String.fromCharCode(92);

/** A zip whose part names use backslashes, the way some Windows writers do. */
function buildZipWithBackslashNames() {
    const zip = new AdmZip();
    zip.addFile('word/styles.xml', Buffer.from('<w:styles/>', 'utf8'));
    zip.addFile('word/document.xml', Buffer.from('<w:document/>', 'utf8'));

    // 'word/styles.xml' and 'word\\styles.xml' are the same length, so
    // replacing the bytes in place keeps every offset valid.
    const buffer = zip.toBuffer();
    const from = Buffer.from('word/styles.xml', 'utf8');
    const to = Buffer.from('word' + BACKSLASH + 'styles.xml', 'utf8');
    for (let i = 0; i + from.length <= buffer.length; i += 1) {
        if (buffer.subarray(i, i + from.length).equals(from)) {
            to.copy(buffer, i);
        }
    }

    return new AdmZip(buffer);
}

test('findDocxPart finds a conventionally named part', () => {
    const zip = new AdmZip();
    zip.addFile('word/styles.xml', Buffer.from('<w:styles/>', 'utf8'));
    const entry = findDocxPart(zip, 'word/styles.xml');
    assert.ok(entry);
    assert.equal(entry.entryName, 'word/styles.xml');
});

test('findDocxPart finds a part stored with backslashes', () => {
    const zip = buildZipWithBackslashNames();
    assert.equal(zip.getEntry('word/styles.xml'), null, 'the fixture must reproduce the miss');
    const entry = findDocxPart(zip, 'word/styles.xml');
    assert.ok(entry, 'the part must be found despite the backslash separators');
    assert.equal(entry.entryName, 'word' + BACKSLASH + 'styles.xml');
});

test('findDocxPart returns undefined for a part that is not there', () => {
    const zip = new AdmZip();
    zip.addFile('word/document.xml', Buffer.from('<w:document/>', 'utf8'));
    assert.equal(findDocxPart(zip, 'word/styles.xml'), undefined);
});

test('findDocxPart also accepts a backslash name for a conventionally stored part', () => {
    const zip = new AdmZip();
    zip.addFile('word/styles.xml', Buffer.from('<w:styles/>', 'utf8'));
    const entry = findDocxPart(zip, 'word' + BACKSLASH + 'styles.xml');
    assert.ok(entry);
    assert.equal(entry.entryName, 'word/styles.xml');
});
