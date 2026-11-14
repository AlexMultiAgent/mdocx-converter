const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { PROFILE_PRESETS, TEMPLATE_LAYOUT } = require('../out/profiles.js');

const REPO_ROOT = path.join(__dirname, '..');
const BASE_DOCX = path.join(__dirname, 'reference-base.docx');
const OUTPUT_DIR = path.join(REPO_ROOT, 'multi-templates');

const A4_WIDTH_TWIPS = 11906;
const A4_HEIGHT_TWIPS = 16838;
const HEADER_TWIPS = 850;
const FOOTER_TWIPS = 990;
const FOOTER_REL_ID = 'rId900';
const PAGE_NUMBER_FONT = 'SimSun';
const PAGE_NUMBER_SIZE_PT = 14;

const PROFILE_ORDER = ['academic', 'business', 'technical', 'official', 'thesis'];
const LANGUAGE_ORDER = ['english', 'chinese'];

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mmToTwips(mm) {
    return Math.round((mm * 1440) / 25.4);
}

function fontXml(ascii, eastAsia) {
    return `<w:rFonts w:ascii="${escapeXml(ascii)}" w:hAnsi="${escapeXml(ascii)}" w:eastAsia="${escapeXml(eastAsia)}" w:cs="${escapeXml(ascii)}"/>`;
}

function sizeXml(sizePt) {
    const halfPoints = Math.round(sizePt * 2);
    return `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
}

function paragraphStyle({ id, name, basedOn = 'Normal', pPr = '', rPr = '', custom = true }) {
    const customAttr = custom ? ' w:customStyle="1"' : '';
    return `<w:style w:type="paragraph"${customAttr} w:styleId="${escapeXml(id)}">`
        + `<w:name w:val="${escapeXml(name)}"/>`
        + `<w:basedOn w:val="${escapeXml(basedOn)}"/>`
        + `<w:qFormat/>`
        + (pPr ? `<w:pPr>${pPr}</w:pPr>` : '')
        + (rPr ? `<w:rPr>${rPr}</w:rPr>` : '')
        + `</w:style>`;
}

function buildStyles(profile, language) {
    const preset = PROFILE_PRESETS[profile];
    const layout = TEMPLATE_LAYOUT[profile];
    if (!layout) {
        throw new Error(`No template layout for profile "${profile}"`);
    }

    const indent = layout.indentTwips[language];
    const lineTwips = preset.lineSpacingTwips ?? Math.round((preset.lineSpacing ?? 1.5) * 240);
    const lineRule = preset.lineSpacingTwips ? 'exact' : 'auto';

    const bodyPPr = '<w:widowControl/>'
        + `<w:spacing w:after="0" w:line="${lineTwips}" w:lineRule="${lineRule}"/>`
        + (indent ? `<w:ind w:firstLine="${indent}"/>` : '')
        + `<w:jc w:val="${layout.justification}"/>`;
    const bodyRPr = fontXml(preset.body.ascii, preset.body.eastAsia) + sizeXml(preset.bodySizePt);

    const definitions = [];

    definitions.push(
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        + '<w:name w:val="Normal"/><w:qFormat/>'
        + `<w:pPr>${bodyPPr}</w:pPr>`
        + `<w:rPr>${bodyRPr}</w:rPr>`
        + '</w:style>'
    );

    for (const [id, name] of [['BodyText', 'Body Text'], ['FirstParagraph', 'First Paragraph'], ['Compact', 'Compact']]) {
        definitions.push(paragraphStyle({ id, name, pPr: bodyPPr, rPr: bodyRPr }));
    }

    const headings = [
        { font: preset.heading1, sizePt: preset.heading1SizePt },
        { font: preset.heading2, sizePt: preset.heading2SizePt },
        { font: preset.heading3, sizePt: preset.heading3SizePt }
    ];

    headings.forEach((heading, index) => {
        const id = `Heading${index + 1}`;
        definitions.push(paragraphStyle({
            id,
            name: `heading ${index + 1}`,
            basedOn: 'Normal',
            custom: false,
            pPr: '<w:keepNext/><w:keepLines/>'
                + `<w:spacing w:before="${layout.headingBeforeTwips[index]}" w:after="${layout.headingAfterTwips[index]}" w:line="${lineTwips}" w:lineRule="${lineRule}"/>`
                + '<w:ind w:firstLine="0"/>'
                + `<w:jc w:val="${layout.headingAlign[index]}"/>`
                + `<w:outlineLvl w:val="${index}"/>`,
            rPr: fontXml(heading.font.ascii, heading.font.eastAsia) + sizeXml(heading.sizePt) + '<w:b/><w:bCs/>'
        }));
    });

    const codeStyle = preset.codeStyle;
    if (codeStyle) {
        definitions.push(paragraphStyle({
            id: 'SourceCode',
            name: 'Source Code',
            pPr: '<w:wordWrap w:val="off"/>'
                + `<w:spacing w:before="60" w:after="60" w:line="${Math.round(codeStyle.lineSpacing * 240)}" w:lineRule="auto"/>`
                + '<w:ind w:left="280" w:right="280" w:firstLine="0"/>'
                + '<w:jc w:val="left"/>'
                + `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXml(codeStyle.shadingFill)}"/>`,
            rPr: fontXml(codeStyle.font, codeStyle.font) + sizeXml(codeStyle.sizePt)
        }));

        definitions.push(
            '<w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar">'
            + '<w:name w:val="Verbatim Char"/>'
            + `<w:rPr>${fontXml(codeStyle.font, codeStyle.font)}${sizeXml(codeStyle.sizePt)}</w:rPr>`
            + '</w:style>'
        );
    } else {
        definitions.push(paragraphStyle({
            id: 'SourceCode',
            name: 'Source Code',
            pPr: '<w:wordWrap w:val="off"/>'
                + '<w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/>'
                + '<w:ind w:left="280" w:right="280" w:firstLine="0"/>'
                + '<w:jc w:val="left"/>',
            rPr: fontXml('Consolas', 'Consolas') + sizeXml(9)
        }));

        definitions.push(
            '<w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar">'
            + '<w:name w:val="Verbatim Char"/>'
            + `<w:rPr>${fontXml('Consolas', 'Consolas')}${sizeXml(9)}</w:rPr>`
            + '</w:style>'
        );
    }

    return definitions.join('');
}

function buildDocument(profile) {
    const preset = PROFILE_PRESETS[profile];
    return (
        `<w:footerReference w:type="default" r:id="${FOOTER_REL_ID}"/>`
        + '<w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>'
        + `<w:pgSz w:w="${A4_WIDTH_TWIPS}" w:h="${A4_HEIGHT_TWIPS}"/>`
        + '<w:pgMar'
        + ` w:top="${mmToTwips(preset.marginTopMm)}"`
        + ` w:right="${mmToTwips(preset.marginRightMm)}"`
        + ` w:bottom="${mmToTwips(preset.marginBottomMm)}"`
        + ` w:left="${mmToTwips(preset.marginLeftMm)}"`
        + ` w:header="${HEADER_TWIPS}" w:footer="${FOOTER_TWIPS}" w:gutter="0"/>`
        + '<w:cols w:space="720"/>'
        + '<w:docGrid w:linePitch="312"/>'
    );
}

function buildFooter() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
        + `<w:r><w:rPr>${fontXml(PAGE_NUMBER_FONT, PAGE_NUMBER_FONT)}${sizeXml(PAGE_NUMBER_SIZE_PT)}</w:rPr><w:fldChar w:fldCharType="begin"/></w:r>`
        + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
        + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        + '<w:r><w:t>1</w:t></w:r>'
        + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
        + '</w:p></w:ftr>';
}

function replaceStyleBlock(stylesXml, styleId, replacement) {
    const regex = new RegExp(`<w:style\\b(?=[^>]*w:styleId="${styleId}")[\\s\\S]*?</w:style>`);
    if (regex.test(stylesXml)) {
        return stylesXml.replace(regex, replacement);
    }

    return stylesXml;
}

function buildTemplate(baseZip, profile, language) {
    let stylesXml = baseZip.readAsText('word/styles.xml');

    for (const styleId of ['Normal', 'BodyText', 'FirstParagraph', 'Compact', 'Heading1', 'Heading2', 'Heading3', 'SourceCode', 'VerbatimChar']) {
        stylesXml = replaceStyleBlock(stylesXml, styleId, '');
    }

    stylesXml = stylesXml.replace(/<\/w:styles>\s*$/, `${buildStyles(profile, language)}</w:styles>`);

    let documentXml = baseZip.readAsText('word/document.xml');
    documentXml = documentXml.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, `<w:sectPr>${buildDocument(profile)}</w:sectPr>`);

    let contentTypes = baseZip.readAsText('[Content_Types].xml');
    contentTypes = contentTypes.replace(
        '</Types>',
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
    );

    let rels = baseZip.readAsText('word/_rels/document.xml.rels');
    rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="${FOOTER_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`
    );

    const output = new AdmZip();
    for (const entry of baseZip.getEntries()) {
        const name = entry.entryName;
        if (name === 'word/styles.xml') {
            output.addFile(name, Buffer.from(stylesXml, 'utf8'));
        } else if (name === 'word/document.xml') {
            output.addFile(name, Buffer.from(documentXml, 'utf8'));
        } else if (name === '[Content_Types].xml') {
            output.addFile(name, Buffer.from(contentTypes, 'utf8'));
        } else if (name === 'word/_rels/document.xml.rels') {
            output.addFile(name, Buffer.from(rels, 'utf8'));
        } else {
            output.addFile(name, entry.getData());
        }
    }

    output.addFile('word/footer1.xml', Buffer.from(buildFooter(), 'utf8'));

    return output;
}

function main() {
    if (!fs.existsSync(BASE_DOCX)) {
        console.error(`Base reference DOCX not found: ${BASE_DOCX}`);
        console.error('Create it with: pandoc --print-default-data-file reference.docx > scripts/reference-base.docx');
        process.exit(1);
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const baseZip = new AdmZip(BASE_DOCX);

    for (const profile of PROFILE_ORDER) {
        for (const language of LANGUAGE_ORDER) {
            const zip = buildTemplate(baseZip, profile, language);
            const target = path.join(OUTPUT_DIR, `reference_${language}_${profile}.docx`);
            zip.writeZip(target);
            console.log(`wrote ${path.relative(REPO_ROOT, target)}`);
        }
    }
}

main();
