const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildDocxStyleOverrides,
    upsertStyleOverride,
    BODY_STYLE_NAMES,
    HEADING_1_STYLE_NAMES
} = require('../../out/docxStyles.js');

const STYLE_REGEX = /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g;

function styleIds(xml) {
    return [...xml.matchAll(/w:styleId="([^"]+)"/g)].map((m) => m[1]);
}

function styleByName(xml, name) {
    for (const block of xml.match(STYLE_REGEX) || []) {
        const found = block.match(/<w:name w:val="([^"]+)"/)?.[1];
        if (found && found.toLowerCase() === name.toLowerCase()) {
            return block;
        }
    }
    return undefined;
}

const LEGACY_CHINESE_STYLES = `
<w:style w:type="paragraph" w:styleId="a"><w:name w:val="List Number"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="a1"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="a3"><w:name w:val="Normal Table"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="21"><w:name w:val="heading 2"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="31"><w:name w:val="heading 3"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="af"><w:name w:val="Body Text"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
`;

const CANONICAL_STYLES = `
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FirstParagraph"><w:name w:val="First Paragraph"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Compact"><w:name w:val="Compact"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
`;

test('body override matches styles by display name, not by hard-coded ids', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(styleByName(updated, 'Normal').includes('w:ascii="Arial"'), 'Normal must be styled');
    assert.ok(styleByName(updated, 'Body Text').includes('w:ascii="Arial"'), 'Body Text must be styled');
});

test('body override does not touch List Number', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(!styleByName(updated, 'List Number').includes('Arial'), 'List Number must be left alone');
});

test('body override does not touch Normal Table', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(!styleByName(updated, 'Normal Table').includes('Arial'), 'Normal Table must be left alone');
});

test('heading override reaches the heading style regardless of its id', () => {
    const override = { styleId: 'Heading1', styleNames: HEADING_1_STYLE_NAMES, asciiFont: 'SimHei', eastAsiaFont: 'SimHei', sizePt: 16 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(styleByName(updated, 'heading 1').includes('w:ascii="SimHei"'), 'heading 1 must be styled');
});

test('no orphan styles are created when the target already exists', () => {
    const override = { styleId: 'Heading1', styleNames: HEADING_1_STYLE_NAMES, asciiFont: 'SimHei', eastAsiaFont: 'SimHei', sizePt: 16 };
    const before = styleIds(LEGACY_CHINESE_STYLES);
    const after = styleIds(upsertStyleOverride(LEGACY_CHINESE_STYLES, override));

    assert.deepEqual(after.sort(), before.sort(), 'no style may be added');
});

test('no orphan styles are created for canonical templates either', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const before = styleIds(CANONICAL_STYLES);
    const after = styleIds(upsertStyleOverride(CANONICAL_STYLES, override));

    assert.deepEqual(after.sort(), before.sort(), 'no style may be added');
});

test('a genuinely missing style is still created', () => {
    const override = { styleId: 'Heading1', styleNames: HEADING_1_STYLE_NAMES, asciiFont: 'SimHei', eastAsiaFont: 'SimHei', sizePt: 16 };
    const updated = upsertStyleOverride('<w:styles></w:styles>', override);

    assert.ok(styleIds(updated).includes('Heading1'), 'the missing style must be inserted');
});

test('buildDocxStyleOverrides returns overrides that carry display names', () => {
    const overrides = buildDocxStyleOverrides({
        styleProfile: 'academic',
        bodyFont: '', bodySizePt: undefined,
        heading1Font: '', heading1SizePt: undefined,
        heading2Font: '', heading2SizePt: undefined,
        heading3Font: '', heading3SizePt: undefined,
        lineSpacing: undefined
    });

    const normal = overrides.find((o) => o.styleId === 'Normal');
    assert.ok(normal.styleNames.includes('Normal'));
    assert.ok(normal.styleNames.includes('Body Text'));
    assert.ok(!normal.styleNames.includes('List Number'));
});

test('the template profile produces no overrides at all', () => {
    const overrides = buildDocxStyleOverrides({
        styleProfile: 'template',
        bodyFont: '', bodySizePt: undefined,
        heading1Font: '', heading1SizePt: undefined,
        heading2Font: '', heading2SizePt: undefined,
        heading3Font: '', heading3SizePt: undefined,
        lineSpacing: undefined
    });

    assert.deepEqual(overrides, []);
});
