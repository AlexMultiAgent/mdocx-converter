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

test('all ten templates exist', () => {
    for (const profile of GENERATED_PROFILES) {
        for (const language of ['english', 'chinese']) {
            assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, `reference_${language}_${profile}.docx`)));
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
