const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildDocxStyleOverrides,
    upsertStyleOverride,
    ensureChildElement,
    upsertInsideElement,
    upsertLineSpacingAttributes,
    normalizeDocxStyleOrder,
    BODY_STYLE_NAMES,
    HEADING_1_STYLE_NAMES
} = require('../../out/docxStyles.js');

const STYLE_REGEX = /<w:style\b[^>]*?(?:\/>|>[\s\S]*?<\/w:style>)/g;

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
<w:styles>
<w:style w:type="paragraph" w:styleId="a"><w:name w:val="List Number"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="a1"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="a3"><w:name w:val="Normal Table"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="21"><w:name w:val="heading 2"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="31"><w:name w:val="heading 3"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="af"><w:name w:val="Body Text"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
</w:styles>
`;

const CANONICAL_STYLES = `
<w:styles>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FirstParagraph"><w:name w:val="First Paragraph"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Compact"><w:name w:val="Compact"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
</w:styles>
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

test('a created style is written inside the w:styles root', () => {
    const override = { styleId: 'Heading1', styleNames: HEADING_1_STYLE_NAMES, asciiFont: 'SimHei', eastAsiaFont: 'SimHei', sizePt: 16 };
    const updated = upsertStyleOverride('<w:styles></w:styles>', override);

    assert.ok(updated.trim().endsWith('</w:styles>'), 'the root tag must stay the last thing');
    assert.ok(updated.indexOf('<w:style ') < updated.indexOf('</w:styles>'),
        'the new style must be inserted before the closing root tag');
});

test('an exact style id match styles the block without creating a new one', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Custom1"><w:name w:val="Some Other Name"/></w:style></w:styles>';
    const override = { styleId: 'Custom1', styleNames: ['Normal'], asciiFont: 'Arial', sizePt: 11 };
    const updated = upsertStyleOverride(styles, override);

    assert.ok(updated.includes('w:ascii="Arial"'), 'the style with the matching id must be styled');
    assert.deepEqual(styleIds(updated), ['Custom1'], 'no second style may be created');
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

// --- OOXML child order -------------------------------------------------

const STYLE_BLOCK = (children) => `<w:style w:type="paragraph" w:styleId="Normal">${children}</w:style>`;

test('a missing w:rPr is inserted after w:name, not before it', () => {
    const updated = ensureChildElement(STYLE_BLOCK('<w:name w:val="Normal"/><w:qFormat/>'), 'w:rPr');
    assert.ok(updated.indexOf('<w:rPr') > updated.indexOf('<w:name'),
        'w:name must stay the first child of w:style');
});

test('a missing w:pPr is inserted before w:rPr', () => {
    const updated = ensureChildElement(
        STYLE_BLOCK('<w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr>'), 'w:pPr');
    assert.ok(updated.indexOf('<w:pPr') > updated.indexOf('<w:name'));
    assert.ok(updated.indexOf('<w:pPr') < updated.indexOf('<w:rPr'));
});

test('a nested w:pPr/w:rPr does not count as the style-level w:rPr', () => {
    const style = STYLE_BLOCK(
        '<w:name w:val="Normal"/><w:pPr><w:rPr><w:b/></w:rPr></w:pPr>');
    const updated = ensureChildElement(style, 'w:rPr');
    assert.ok(updated.indexOf('</w:pPr>') < updated.lastIndexOf('<w:rPr'),
        'a top-level w:rPr must be added after the paragraph properties');
});

test('a missing w:rFonts is inserted before w:sz', () => {
    const updated = upsertInsideElement(
        STYLE_BLOCK('<w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr>'),
        'w:rPr', /<w:rFonts\b[^>]*\/>/, '<w:rFonts w:ascii="X"/>');
    assert.ok(updated.indexOf('<w:rFonts') < updated.indexOf('<w:sz'));
});

test('a missing w:rFonts is inserted before w:lang', () => {
    const updated = upsertInsideElement(
        STYLE_BLOCK('<w:name w:val="Normal"/><w:rPr><w:lang w:val="zh-CN"/></w:rPr>'),
        'w:rPr', /<w:rFonts\b[^>]*\/>/, '<w:rFonts w:ascii="X"/>');
    assert.ok(updated.indexOf('<w:rFonts') < updated.indexOf('<w:lang'));
});

test('a missing w:color is inserted before w:sz', () => {
    const updated = upsertInsideElement(
        STYLE_BLOCK('<w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr>'),
        'w:rPr', /<w:color\b[^>]*\/>/, '<w:color w:val="000000"/>');
    assert.ok(updated.indexOf('<w:color') < updated.indexOf('<w:sz'));
});

test('a self-closing w:rPr is expanded before a child is inserted', () => {
    const updated = upsertInsideElement(
        STYLE_BLOCK('<w:name w:val="Normal"/><w:rPr/>'),
        'w:rPr', /<w:rFonts\b[^>]*\/>/, '<w:rFonts w:ascii="X"/>');
    assert.ok(updated.includes('<w:rPr><w:rFonts w:ascii="X"/></w:rPr>'),
        'the child must be inserted into the expanded element');
});

test('the style-level w:rPr is used, not the paragraph mark one', () => {
    const style = STYLE_BLOCK(
        '<w:name w:val="Normal"/><w:pPr><w:rPr><w:b/></w:rPr><w:jc w:val="both"/></w:pPr>' +
        '<w:rPr><w:sz w:val="24"/></w:rPr>');
    const updated = upsertStyleOverride(style, {
        styleId: 'Normal',
        styleNames: ['Normal'],
        asciiFont: 'Times New Roman',
        sizePt: 12
    });
    const paragraphMark = updated.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)[0];
    const styleRPr = updated.match(/<\/w:pPr>([\s\S]*?)<\/w:style>/)[1];
    assert.ok(!paragraphMark.includes('w:rFonts'), 'the paragraph mark must not get the font');
    assert.ok(styleRPr.includes('w:rFonts'), 'the style-level w:rPr must get the font');
});

test('a missing w:spacing is inserted before w:ind and w:jc', () => {
    const updated = upsertLineSpacingAttributes(
        STYLE_BLOCK('<w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="480"/><w:jc w:val="both"/></w:pPr>'),
        360, 'auto');
    assert.ok(updated.indexOf('<w:spacing') > updated.indexOf('<w:pPr'));
    assert.ok(updated.indexOf('<w:spacing') < updated.indexOf('<w:ind'));
    assert.ok(updated.indexOf('<w:spacing') < updated.indexOf('<w:jc'));
});

test('a missing w:shd is inserted before w:spacing and w:jc', () => {
    const updated = upsertStyleOverride(
        STYLE_BLOCK('<w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/><w:jc w:val="both"/></w:pPr>'),
        {
            styleId: 'Normal',
            styleNames: ['Normal'],
            shadingFill: 'F3F4F6'
        });
    assert.ok(updated.indexOf('<w:shd') < updated.indexOf('<w:spacing'));
    assert.ok(updated.indexOf('<w:shd') < updated.indexOf('<w:jc'));
});

// --- normalising an inherited out-of-order style ------------------------

test('a w:b that follows w:sz is moved in front of it', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Heading1">'
        + '<w:name w:val="heading 1"/>'
        + '<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="32"/><w:szCs w:val="32"/><w:b/><w:bCs/></w:rPr>'
        + '</w:style></w:styles>';

    const updated = normalizeDocxStyleOrder(styles);
    const rPr = updated.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)[0];

    assert.ok(rPr.indexOf('<w:b/>') < rPr.indexOf('<w:sz'), 'w:b must come before w:sz');
    assert.ok(rPr.indexOf('<w:bCs/>') < rPr.indexOf('<w:sz'), 'w:bCs must come before w:sz');
    assert.ok(rPr.indexOf('<w:rFonts') < rPr.indexOf('<w:b/>'), 'w:rFonts stays in front of w:b');
});

test('a w:shd that follows w:jc is moved in front of it', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="SourceCode">'
        + '<w:name w:val="Source Code"/>'
        + '<w:pPr><w:wordWrap w:val="off"/><w:spacing w:after="60"/><w:ind w:left="280"/>'
        + '<w:jc w:val="left"/><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/></w:pPr>'
        + '</w:style></w:styles>';

    const updated = normalizeDocxStyleOrder(styles);
    const pPr = updated.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)[0];

    assert.ok(pPr.indexOf('<w:shd') < pPr.indexOf('<w:wordWrap'), 'w:shd must come before w:wordWrap');
    assert.ok(pPr.indexOf('<w:shd') < pPr.indexOf('<w:spacing'), 'w:shd must come before w:spacing');
    assert.ok(pPr.indexOf('<w:shd') < pPr.indexOf('<w:jc'), 'w:shd must come before w:jc');
});

test('an already ordered style is left byte for byte alone', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Normal">'
        + '<w:name w:val="Normal"/>'
        + '<w:pPr><w:spacing w:after="0"/><w:ind w:firstLine="480"/><w:jc w:val="both"/></w:pPr>'
        + '<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr>'
        + '</w:style></w:styles>';

    assert.equal(normalizeDocxStyleOrder(styles), styles);
});

test('a tag the schema does not know goes last and keeps its relative order', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Normal">'
        + '<w:name w:val="Normal"/>'
        + '<w:rPr><w:mysteryOne/><w:sz w:val="24"/><w:mysteryTwo/></w:rPr>'
        + '</w:style></w:styles>';

    const updated = normalizeDocxStyleOrder(styles);
    const rPr = updated.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)[0];

    assert.ok(rPr.indexOf('<w:sz') < rPr.indexOf('<w:mysteryOne'), 'the unknown tag goes last');
    assert.ok(rPr.indexOf('<w:mysteryOne') < rPr.indexOf('<w:mysteryTwo'), 'the unknown tags keep their order');
});

test('the paragraph mark run properties are normalised too', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Normal">'
        + '<w:name w:val="Normal"/>'
        + '<w:pPr><w:spacing w:after="0"/><w:rPr><w:sz w:val="24"/><w:b/></w:rPr></w:pPr>'
        + '</w:style></w:styles>';

    const updated = normalizeDocxStyleOrder(styles);
    const pPr = updated.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)[0];

    assert.ok(pPr.indexOf('<w:b/>') < pPr.indexOf('<w:sz'), 'w:b must come before w:sz');
    assert.ok(pPr.indexOf('<w:spacing') < pPr.indexOf('<w:rPr'), 'the paragraph mark stays behind the spacing');
});

test('normalising keeps the style block itself untouched', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Normal">'
        + '<w:name w:val="Normal"/><w:qFormat/>'
        + '<w:rPr><w:sz w:val="24"/><w:b/></w:rPr>'
        + '</w:style></w:styles>';

    const updated = normalizeDocxStyleOrder(styles);

    assert.ok(updated.indexOf('<w:name') < updated.indexOf('<w:rPr'), 'w:name stays the first child');
    assert.ok(updated.includes('<w:qFormat/>'), 'the other style children survive');
});

test('a style without run or paragraph properties is left alone', () => {
    const styles = '<w:styles><w:style w:type="paragraph" w:styleId="Empty">'
        + '<w:name w:val="Empty"/>'
        + '</w:style></w:styles>';

    assert.equal(normalizeDocxStyleOrder(styles), styles);
});

// --- self-closing style blocks and created styles -----------------------

test('a self-closing style block is not merged with the following one', () => {
    const styles = '<w:styles>'
        + '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Empty"/>'
        + '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
        + '</w:styles>';
    const updated = upsertStyleOverride(styles, {
        styleId: 'Normal',
        styleNames: ['Normal'],
        asciiFont: 'Arial'
    });

    const blocks = updated.match(STYLE_REGEX) || [];
    assert.equal(blocks.length, 2, 'the two style blocks must stay separate');
    assert.ok(blocks[0].endsWith('/>'), 'the self-closing style must stay self-closing');
    assert.ok(blocks[1].includes('w:ascii="Arial"'), 'the Normal style must get the font');
    assert.ok(updated.trim().endsWith('</w:styles>'), 'nothing may be written outside the root');
});

test('a created style carries the display name from the override', () => {
    const updated = upsertStyleOverride('<w:styles></w:styles>', {
        styleId: 'Heading1',
        styleNames: ['heading 1'],
        asciiFont: 'SimHei',
        sizePt: 16
    });

    assert.ok(updated.includes('<w:name w:val="heading 1"/>'),
        'the created style must use the display name the override carries');
});

test('a created character style is a character style and gets no paragraph shading', () => {
    const updated = upsertStyleOverride('<w:styles></w:styles>', {
        styleId: 'VerbatimChar',
        styleNames: ['Verbatim Char'],
        asciiFont: 'Consolas',
        sizePt: 10,
        shadingFill: 'F3F4F6'
    });

    assert.ok(updated.includes('w:type="character"'), 'the created style must be a character style');
    assert.ok(!updated.includes('<w:pPr'), 'a character style must not get paragraph properties');
    assert.ok(!updated.includes('<w:shd'), 'a character style must not get a paragraph shading');
});
