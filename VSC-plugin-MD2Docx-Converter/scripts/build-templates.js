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
const GUTTER_TWIPS = 0;
const COLUMNS_SPACE_TWIPS = 720;
const FOOTER_REL_ID = 'rId900';

// Structural OOXML constants — the same for every template. They are layout
// scaffolding, not per-profile design data, so they stay here rather than in
// the preset tables.
const BODY_SPACING_AFTER_TWIPS = 0;
const HEADING_FIRST_LINE_INDENT_TWIPS = 0;
const CODE_SPACING_BEFORE_TWIPS = 60;
const CODE_SPACING_AFTER_TWIPS = 60;
const CODE_INDENT_TWIPS = 280;
const CODE_JUSTIFICATION = 'left';
const DOC_GRID_LINE_PITCH = 312;

const PROFILE_ORDER = ['academic', 'business', 'technical', 'official', 'thesis'];
const LANGUAGE_ORDER = ['english', 'chinese'];

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function setXmlText(xml, qualifiedName, value) {
    const name = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const element = new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`);
    return xml.replace(element, (match) => {
        const openingTag = match.match(new RegExp(`^<${name}(?:\\s[^>]*)?>`))[0];
        return `${openingTag}${escapeXml(value)}</${qualifiedName}>`;
    });
}

function removeXmlElement(xml, qualifiedName) {
    const name = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return xml.replace(new RegExp(`<${name}\\b(?:\\s[^>]*)?(?:\\/>|>[\\s\\S]*?</${name}>)`), '');
}

function sanitizeCoreProperties(xml) {
    let sanitized = xml;
    for (const field of ['dc:title', 'dc:creator', 'cp:lastModifiedBy', 'dc:subject', 'cp:keywords']) {
        sanitized = setXmlText(sanitized, field, '');
    }
    return setXmlText(sanitized, 'cp:revision', '1');
}

function sanitizeExtendedProperties(xml) {
    let sanitized = removeXmlElement(xml, 'HLinks');
    const values = {
        Company: '',
        Manager: '',
        Template: 'Normal.dotm',
        TotalTime: '0',
        Pages: '1',
        Words: '0',
        Characters: '0',
        Lines: '0',
        Paragraphs: '0',
        CharactersWithSpaces: '0'
    };

    for (const [field, value] of Object.entries(values)) {
        sanitized = setXmlText(sanitized, field, value);
    }
    return sanitized;
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

function requirePreset(profile) {
    const preset = PROFILE_PRESETS[profile];
    if (!preset) {
        throw new Error(`No style preset for profile "${profile}"`);
    }
    return preset;
}

function requireLayout(profile) {
    const layout = TEMPLATE_LAYOUT[profile];
    if (!layout) {
        throw new Error(`No template layout for profile "${profile}"`);
    }
    return layout;
}

/** Line height and rule come from the preset — never from a literal here. */
function resolveLineSpacing(preset, profile) {
    if (preset.lineSpacingRule === undefined) {
        throw new Error(`Preset "${profile}" defines no lineSpacingRule`);
    }

    if (preset.lineSpacingTwips !== undefined) {
        return { twips: preset.lineSpacingTwips, rule: preset.lineSpacingRule };
    }

    if (preset.lineSpacing !== undefined) {
        return { twips: Math.round(preset.lineSpacing * 240), rule: preset.lineSpacingRule };
    }

    throw new Error(`Preset "${profile}" defines neither lineSpacing nor lineSpacingTwips`);
}

function buildStyles(profile, language) {
    const preset = requirePreset(profile);
    const layout = requireLayout(profile);
    const codeStyle = preset.codeStyle;
    if (!codeStyle) {
        throw new Error(`Preset "${profile}" defines no codeStyle`);
    }

    const indent = layout.indentTwips[language];
    const { twips: lineTwips, rule: lineRule } = resolveLineSpacing(preset, profile);

    const bodyPPr = '<w:widowControl/>'
        + `<w:spacing w:after="${BODY_SPACING_AFTER_TWIPS}" w:line="${lineTwips}" w:lineRule="${lineRule}"/>`
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
                + `<w:ind w:firstLine="${HEADING_FIRST_LINE_INDENT_TWIPS}"/>`
                + `<w:jc w:val="${layout.headingAlign[index]}"/>`
                + `<w:outlineLvl w:val="${index}"/>`,
            rPr: fontXml(heading.font.ascii, heading.font.eastAsia) + '<w:b/><w:bCs/>' + sizeXml(heading.sizePt)
        }));
    });

    const codeShading = codeStyle.shadingFill
        ? `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXml(codeStyle.shadingFill)}"/>`
        : '';

    definitions.push(paragraphStyle({
        id: 'SourceCode',
        name: 'Source Code',
        pPr: codeShading
            + '<w:wordWrap w:val="off"/>'
            + `<w:spacing w:before="${CODE_SPACING_BEFORE_TWIPS}" w:after="${CODE_SPACING_AFTER_TWIPS}" w:line="${Math.round(codeStyle.lineSpacing * 240)}" w:lineRule="auto"/>`
            + `<w:ind w:left="${CODE_INDENT_TWIPS}" w:right="${CODE_INDENT_TWIPS}" w:firstLine="${HEADING_FIRST_LINE_INDENT_TWIPS}"/>`
            + `<w:jc w:val="${CODE_JUSTIFICATION}"/>`,
        rPr: fontXml(codeStyle.font, codeStyle.font) + sizeXml(codeStyle.sizePt)
    }));

    definitions.push(
        '<w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar">'
        + '<w:name w:val="Verbatim Char"/>'
        + `<w:rPr>${fontXml(codeStyle.font, codeStyle.font)}${sizeXml(codeStyle.sizePt)}</w:rPr>`
        + '</w:style>'
    );

    return definitions.join('');
}

function buildDocument(profile) {
    const preset = requirePreset(profile);
    return (
        `<w:footerReference w:type="default" r:id="${FOOTER_REL_ID}"/>`
        + '<w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>'
        + `<w:pgSz w:w="${A4_WIDTH_TWIPS}" w:h="${A4_HEIGHT_TWIPS}"/>`
        + '<w:pgMar'
        + ` w:top="${mmToTwips(preset.marginTopMm)}"`
        + ` w:right="${mmToTwips(preset.marginRightMm)}"`
        + ` w:bottom="${mmToTwips(preset.marginBottomMm)}"`
        + ` w:left="${mmToTwips(preset.marginLeftMm)}"`
        + ` w:header="${HEADER_TWIPS}" w:footer="${FOOTER_TWIPS}" w:gutter="${GUTTER_TWIPS}"/>`
        + `<w:cols w:space="${COLUMNS_SPACE_TWIPS}"/>`
        + `<w:docGrid w:linePitch="${DOC_GRID_LINE_PITCH}"/>`
    );
}

function buildFooter(pageNumberFont, pageNumberSizePt) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
        + `<w:r><w:rPr>${fontXml(pageNumberFont, pageNumberFont)}${sizeXml(pageNumberSizePt)}</w:rPr><w:fldChar w:fldCharType="begin"/></w:r>`
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

/** Strip the base document's sample body, keeping only the section properties. */
function buildDocumentBody(documentXml) {
    return documentXml.replace(/<w:body\b[^>]*>[\s\S]*<\/w:body>/, (bodyXml) => {
        const sectPrMatch = bodyXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
        if (!sectPrMatch) {
            throw new Error('Base reference DOCX has no sectPr');
        }
        return `<w:body>${sectPrMatch[0]}</w:body>`;
    });
}

function buildTemplate(baseZip, profile, language) {
    const layout = requireLayout(profile);

    let stylesXml = baseZip.readAsText('word/styles.xml');

    for (const styleId of ['Normal', 'BodyText', 'FirstParagraph', 'Compact', 'Heading1', 'Heading2', 'Heading3', 'SourceCode', 'VerbatimChar']) {
        stylesXml = replaceStyleBlock(stylesXml, styleId, '');
    }

    stylesXml = stylesXml.replace(/<\/w:styles>\s*$/, `${buildStyles(profile, language)}</w:styles>`);

    let documentXml = buildDocumentBody(baseZip.readAsText('word/document.xml'));
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
        } else if (name === 'docProps/core.xml') {
            output.addFile(name, Buffer.from(sanitizeCoreProperties(entry.getData().toString('utf8')), 'utf8'));
        } else if (name === 'docProps/app.xml') {
            output.addFile(name, Buffer.from(sanitizeExtendedProperties(entry.getData().toString('utf8')), 'utf8'));
        } else {
            output.addFile(name, entry.getData());
        }
    }

    output.addFile('word/footer1.xml', Buffer.from(buildFooter(layout.pageNumberFont, layout.pageNumberSizePt), 'utf8'));

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
