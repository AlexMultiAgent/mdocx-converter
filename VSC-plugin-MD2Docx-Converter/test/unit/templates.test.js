const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'multi-templates');
const { PROFILE_PRESETS, TEMPLATE_LAYOUT } = require('../../out/profiles.js');

const GENERATED_PROFILES = ['academic', 'business', 'technical', 'official', 'thesis'];

function readTemplate(profile, language) {
    const file = path.join(TEMPLATE_DIR, `reference_${language}_${profile}.docx`);
    assert.ok(fs.existsSync(file), `missing template ${path.basename(file)}`);
    return new AdmZip(file);
}

function xmlText(xml, qualifiedName) {
    const match = xml.match(new RegExp(`<${qualifiedName}(?:\\s[^>]*)?>([\\s\\S]*?)</${qualifiedName}>`));
    return match ? match[1] : undefined;
}

test('all ten templates exist', () => {
    for (const profile of GENERATED_PROFILES) {
        for (const language of ['english', 'chinese']) {
            assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, `reference_${language}_${profile}.docx`)));
        }
    }
});

test('all ten templates strip placeholder core properties', () => {
    for (const profile of GENERATED_PROFILES) {
        for (const language of ['english', 'chinese']) {
            const core = readTemplate(profile, language).readAsText('docProps/core.xml');
            assert.equal(xmlText(core, 'dc:title'), '', `${profile}/${language} must not ship pandoc's title placeholder`);
            assert.equal(xmlText(core, 'dc:creator'), '', `${profile}/${language} must not ship pandoc's author placeholder`);
            assert.equal(xmlText(core, 'cp:keywords') ?? '', '');
            assert.equal(xmlText(core, 'cp:revision') ?? '1', '1');
        }
    }
});

test('all ten templates strip stale extended-property statistics', () => {
    for (const profile of GENERATED_PROFILES) {
        for (const language of ['english', 'chinese']) {
            const app = readTemplate(profile, language).readAsText('docProps/app.xml');
            assert.equal(xmlText(app, 'Template'), 'Normal.dotm');
            for (const field of ['TotalTime', 'Words', 'Characters', 'Lines', 'Paragraphs', 'CharactersWithSpaces']) {
                assert.equal(xmlText(app, field), '0', `${profile}/${language} ${field} must be reset`);
            }
            assert.ok(!/<HLinks\b/.test(app), `${profile}/${language} must not carry hyperlink statistics`);
        }
    }
});

for (const profile of GENERATED_PROFILES) {
    for (const language of ['english', 'chinese']) {
        test(`${profile}/${language} is single column A4`, () => {
            const zip = readTemplate(profile, language);
            const document = zip.readAsText('word/document.xml');
            const sectPr = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)[0];
            assert.ok(!/w:num="2"/.test(sectPr), 'must not be two columns');
            assert.match(sectPr, /<w:pgSz w:w="11906" w:h="16838"\s*\/>/);
        });

        test(`${profile}/${language} carries the preset page margins`, () => {
            const zip = readTemplate(profile, language);
            const document = zip.readAsText('word/document.xml');
            const sectPr = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)[0];
            const pgMar = sectPr.match(/<w:pgMar\b[^>]*\/>/)[0];
            const preset = PROFILE_PRESETS[profile];
            const toTwips = (mm) => Math.round((mm * 1440) / 25.4);
            assert.match(pgMar, new RegExp(`w:top="${toTwips(preset.marginTopMm)}"`));
            assert.match(pgMar, new RegExp(`w:bottom="${toTwips(preset.marginBottomMm)}"`));
            assert.match(pgMar, new RegExp(`w:left="${toTwips(preset.marginLeftMm)}"`));
            assert.match(pgMar, new RegExp(`w:right="${toTwips(preset.marginRightMm)}"`));
        });

        test(`${profile}/${language} defines Normal as the default paragraph style`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            assert.ok(normal.includes('w:default="1"'), 'Normal must be the default style');
            assert.match(normal, /<w:rFonts[^>]*w:ascii="[^"]+"[^>]*w:eastAsia="[^"]+"/);
        });

        test(`${profile}/${language} splits latin and east-asian fonts`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            const preset = PROFILE_PRESETS[profile];
            assert.match(normal, new RegExp(`w:ascii="${preset.body.ascii}"`));
            assert.match(normal, new RegExp(`w:eastAsia="${preset.body.eastAsia}"`));
        });

        test(`${profile}/${language} uses the preset body size`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            const preset = PROFILE_PRESETS[profile];
            assert.match(normal, new RegExp(`<w:sz w:val="${preset.bodySizePt * 2}"/>`));
        });

        test(`${profile}/${language} defines canonical pandoc style ids`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            for (const id of ['BodyText', 'FirstParagraph', 'Compact', 'Heading1', 'Heading2', 'Heading3', 'SourceCode', 'VerbatimChar']) {
                assert.ok(styles.includes(`w:styleId="${id}"`), `missing style ${id}`);
            }
        });

        test(`${profile}/${language} applies the preset line spacing rule`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            const preset = PROFILE_PRESETS[profile];
            const expectedTwips = preset.lineSpacingTwips ?? Math.round(preset.lineSpacing * 240);
            assert.match(normal, new RegExp(`w:line="${expectedTwips}"`));
            assert.match(normal, new RegExp(`w:lineRule="${preset.lineSpacingRule}"`));
        });

        test(`${profile}/${language} gives code blocks the preset code style`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const sourceCode = styles.match(/<w:style\b[^>]*w:styleId="SourceCode"[^>]*>[\s\S]*?<\/w:style>/)[0];
            const codeStyle = PROFILE_PRESETS[profile].codeStyle;
            assert.ok(codeStyle, 'the preset must declare a code style');
            assert.match(sourceCode, new RegExp(`w:ascii="${codeStyle.font}"`));
            assert.match(sourceCode, new RegExp(`w:eastAsia="${codeStyle.font}"`));
            assert.match(sourceCode, new RegExp(`<w:sz w:val="${codeStyle.sizePt * 2}"/>`));
            assert.match(sourceCode, new RegExp(`w:line="${Math.round(codeStyle.lineSpacing * 240)}"`));
            if (codeStyle.shadingFill) {
                assert.match(sourceCode, new RegExp(`w:fill="${codeStyle.shadingFill}"`));
            } else {
                assert.ok(!/<w:shd\b/.test(sourceCode), 'no shading when the preset declares none');
            }
        });

        test(`${profile}/${language} renders the page number with the layout font`, () => {
            const zip = readTemplate(profile, language);
            const footer = zip.readAsText('word/footer1.xml');
            const layout = TEMPLATE_LAYOUT[profile];
            assert.match(footer, new RegExp(`w:ascii="${layout.pageNumberFont}"`));
            assert.match(footer, new RegExp(`w:eastAsia="${layout.pageNumberFont}"`));
            assert.match(footer, new RegExp(`<w:sz w:val="${layout.pageNumberSizePt * 2}"/>`));
        });

        test(`${profile}/${language} carries no placeholder body content`, () => {
            const zip = readTemplate(profile, language);
            const document = zip.readAsText('word/document.xml');
            const body = document.match(/<w:body\b[^>]*>[\s\S]*<\/w:body>/)[0];
            const inner = body.replace(/<w:body\b[^>]*>/, '').replace(/<\/w:body>/, '');
            assert.ok(!/<w:p\b/.test(inner), 'the body must hold no sample paragraphs');
            assert.match(inner, /<w:sectPr\b/, 'the body must keep the section properties');
        });
    }
}

test('chinese templates indent the first line, english templates do not', () => {
    const chinese = new AdmZip(path.join(TEMPLATE_DIR, 'reference_chinese_academic.docx')).readAsText('word/styles.xml');
    const english = new AdmZip(path.join(TEMPLATE_DIR, 'reference_english_academic.docx')).readAsText('word/styles.xml');
    const indent = TEMPLATE_LAYOUT.academic.indentTwips;
    assert.match(chinese, new RegExp(`<w:ind w:firstLine="${indent.chinese}"\\s*/>`));
    assert.ok(!new RegExp(`<w:ind w:firstLine="${indent.chinese}"\\s*/>`).test(english));
});

test('templates carry a page-number footer', () => {
    const zip = readTemplate('academic', 'chinese');
    assert.ok(zip.getEntry('word/footer1.xml'), 'footer part missing');
    assert.match(zip.readAsText('word/footer1.xml'), /PAGE/);
});

test('the footer is wired into the section properties', () => {
    const zip = readTemplate('academic', 'chinese');
    const document = zip.readAsText('word/document.xml');
    assert.match(document, /<w:footerReference w:type="default" r:id="[^"]+"\/>/);
    assert.match(zip.readAsText('word/_rels/document.xml.rels'), /footer1\.xml/);
});

// --- OOXML child order of the generated templates ----------------------
//
// The order tables live here rather than in the implementation, so the check
// stays independent of the code that writes the templates.

const CT_RPR_ORDER = [
    'w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps',
    'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint',
    'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing',
    'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect',
    'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang',
    'w:eastAsianLayout', 'w:specVanish', 'w:oMath'
];

const CT_PPR_ORDER = [
    'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr',
    'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs',
    'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct',
    'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd',
    'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents',
    'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment',
    'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr',
    'w:pPrChange'
];

const STYLE_BLOCK_REGEX = /<w:style\b[^>]*?(?:\/>|>[\s\S]*?<\/w:style>)/g;

/** Index just past the `>` that closes the tag starting at `lt`. */
function findTagEnd(xml, lt) {
    let quote;
    for (let i = lt + 1; i < xml.length; i++) {
        const ch = xml[i];
        if (quote) {
            if (ch === quote) {
                quote = undefined;
            }
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (ch === '>') {
            return i + 1;
        }
    }
    return xml.length;
}

/**
 * The direct children of `elementXml` — a whole element such as
 * `<w:pPr …>…</w:pPr>`. A nested element counts as one child, so the `w:rPr`
 * inside a `w:pPr` is not mistaken for a child of the `w:pPr`.
 */
function directChildren(elementXml) {
    const lt = elementXml.indexOf('<');
    if (lt < 0) {
        return [];
    }

    const openEnd = findTagEnd(elementXml, lt);
    if (elementXml.slice(lt, openEnd).endsWith('/>')) {
        return [];
    }

    const closeStart = elementXml.lastIndexOf('</');
    if (closeStart < openEnd) {
        return [];
    }

    const inner = elementXml.slice(openEnd, closeStart);
    const children = [];
    let depth = 0;
    let open;
    let i = 0;

    while (i < inner.length) {
        const tagStart = inner.indexOf('<', i);
        if (tagStart < 0) {
            break;
        }
        if (inner.startsWith('<!--', tagStart)) {
            const end = inner.indexOf('-->', tagStart);
            i = end < 0 ? inner.length : end + 3;
            continue;
        }

        const tagEnd = findTagEnd(inner, tagStart);
        const isClose = inner[tagStart + 1] === '/';
        const isSelfClosing = inner[tagEnd - 2] === '/';
        const name = inner.slice(tagStart + 1 + (isClose ? 1 : 0)).split(/[\s/>]/)[0];

        if (isClose) {
            depth--;
            if (depth === 0 && open) {
                open.end = openEnd + tagEnd;
                children.push(open);
                open = undefined;
            }
        } else if (isSelfClosing) {
            if (depth === 0) {
                children.push({ name, start: openEnd + tagStart, end: openEnd + tagEnd });
            }
        } else {
            if (depth === 0) {
                open = { name, start: openEnd + tagStart, end: openEnd + tagEnd };
            }
            depth++;
        }

        i = tagEnd;
    }

    return children;
}

/** The style blocks whose run or paragraph properties break the schema order. */
function outOfOrderBlocks(stylesXml) {
    const violations = [];

    for (const block of stylesXml.match(STYLE_BLOCK_REGEX) || []) {
        const label = (block.match(/<w:name w:val="([^"]+)"/) || [])[1]
            || (block.match(/w:styleId="([^"]+)"/) || [])[1];

        for (const child of directChildren(block)) {
            if (child.name !== 'w:rPr' && child.name !== 'w:pPr') {
                continue;
            }

            const order = child.name === 'w:rPr' ? CT_RPR_ORDER : CT_PPR_ORDER;
            const names = directChildren(block.slice(child.start, child.end)).map((c) => c.name);
            let previous = -1;

            for (const name of names) {
                const index = order.indexOf(name);
                if (index < 0) {
                    continue;
                }
                if (index < previous) {
                    violations.push(`${label} ${child.name}: ${names.join(' ')}`);
                    break;
                }
                previous = index;
            }
        }
    }

    return violations;
}

test('every bundled template keeps its style properties in schema order', () => {
    for (const profile of GENERATED_PROFILES) {
        for (const language of ['english', 'chinese']) {
            const zip = readTemplate(profile, language);
            const violations = outOfOrderBlocks(zip.readAsText('word/styles.xml'));
            assert.deepEqual(violations, [], `${profile}/${language} has out-of-order style properties`);
        }
    }
});
