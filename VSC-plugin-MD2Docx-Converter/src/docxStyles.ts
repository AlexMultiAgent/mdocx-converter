import { PROFILE_PRESETS, resolveFontPair, resolveLineSpacingTwips } from './profiles';
import type { CodeStyle, ProfilePreset, StyleProfile } from './profiles';

export interface DocxStyleOverride {
    styleId: string;
    /** Display names (w:name) to match. Matched case-insensitively. */
    styleNames: string[];
    asciiFont?: string;
    eastAsiaFont?: string;
    sizePt?: number;
    lineSpacingTwips?: number;
    lineSpacingRule?: 'auto' | 'exact';
    color?: string;
    shadingFill?: string;
}

/**
 * Display names of the paragraph styles that carry body text.
 *
 * Matched by name, never by id: style ids differ between templates
 * (Chinese Word templates use `a`/`a1`, pandoc's use `Normal`), while
 * display names are stable. `Text` covers English templates that name the
 * body style `Text`; `List Number` and `Normal Table` are deliberately
 * absent — they are different styles that happen to own the ids `a`/`a1`
 * in some templates.
 */
export const BODY_STYLE_NAMES = ['Normal', 'Body Text', 'Text', 'First Paragraph', 'Compact'];
export const HEADING_1_STYLE_NAMES = ['heading 1'];
export const HEADING_2_STYLE_NAMES = ['heading 2'];
export const HEADING_3_STYLE_NAMES = ['heading 3'];
export const SOURCE_CODE_STYLE_NAMES = ['Source Code'];
export const VERBATIM_CHAR_STYLE_NAMES = ['Verbatim Char'];

const STYLE_BLOCK_REGEX = /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g;

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function ensureChildElement(xml: string, tagName: string): string {
    if (new RegExp(`<${tagName}\\b`).test(xml)) {
        return xml;
    }

    return xml.replace(/(<w:style\b[^>]*>)/, `$1<${tagName}/>`);
}

export function upsertInsideElement(xml: string, tagName: string, childRegex: RegExp, childXml: string): string {
    const elementRegex = new RegExp(`<${tagName}\\b[^>]*(?:/>|>[\\s\\S]*?</${tagName}>)`);
    return xml.replace(elementRegex, (elementXml) => {
        if (childRegex.test(elementXml)) {
            return elementXml.replace(childRegex, childXml);
        }

        if (elementXml.endsWith('/>')) {
            return elementXml.replace(/\/>$/, `>${childXml}</${tagName}>`);
        }

        return elementXml.replace(new RegExp(`</${tagName}>$`), `${childXml}</${tagName}>`);
    });
}

export function upsertXmlAttribute(xml: string, attrName: string, value: string): string {
    const attrRegex = new RegExp(`${escapeRegex(attrName)}="[^"]*"`);
    if (attrRegex.test(xml)) {
        return xml.replace(attrRegex, `${attrName}="${escapeXmlAttribute(value)}"`);
    }

    return xml.replace(/\/>$/, ` ${attrName}="${escapeXmlAttribute(value)}"/>`);
}

/**
 * Set `w:line` / `w:lineRule` on the style's `w:spacing` element while keeping the
 * template's `w:before` / `w:after` paragraph spacing intact. Only the two line
 * attributes are touched; a missing `w:spacing` element is inserted into `w:pPr`.
 */
export function upsertLineSpacingAttributes(xml: string, lineTwips: number, rule: 'auto' | 'exact'): string {
    const pPrRegex = /<w:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/w:pPr>)/;
    if (!pPrRegex.test(xml)) {
        return xml;
    }

    return xml.replace(pPrRegex, (pPrXml) => {
        const spacingRegex = /<w:spacing\b[^>]*\/>/;
        if (spacingRegex.test(pPrXml)) {
            return pPrXml.replace(spacingRegex, (spacingXml) => {
                let updated = spacingXml;
                updated = upsertXmlAttribute(updated, 'w:line', String(lineTwips));
                updated = upsertXmlAttribute(updated, 'w:lineRule', rule);
                return updated;
            });
        }

        const spacingXml = `<w:spacing w:line="${lineTwips}" w:lineRule="${rule}"/>`;
        if (pPrXml.endsWith('/>')) {
            return pPrXml.replace(/\/>$/, `>${spacingXml}</w:pPr>`);
        }

        return pPrXml.replace(/<\/w:pPr>$/, `${spacingXml}</w:pPr>`);
    });
}

export function updateStyleXml(styleXml: string, override: DocxStyleOverride): string {
    let updated = styleXml;
    updated = ensureChildElement(updated, 'w:rPr');

    if (override.lineSpacingTwips || override.shadingFill) {
        updated = ensureChildElement(updated, 'w:pPr');
    }

    if (override.asciiFont || override.eastAsiaFont) {
        const ascii = override.asciiFont || override.eastAsiaFont || '';
        const eastAsia = override.eastAsiaFont || override.asciiFont || '';
        const fontXml = `<w:rFonts w:ascii="${escapeXmlAttribute(ascii)}" w:hAnsi="${escapeXmlAttribute(ascii)}" w:eastAsia="${escapeXmlAttribute(eastAsia)}" w:cs="${escapeXmlAttribute(ascii)}"/>`;
        updated = upsertInsideElement(updated, 'w:rPr', /<w:rFonts\b[^>]*\/>/, fontXml);
    }

    if (override.sizePt) {
        const halfPoints = String(Math.round(override.sizePt * 2));
        updated = upsertInsideElement(updated, 'w:rPr', /<w:sz\b[^>]*\/>/, `<w:sz w:val="${halfPoints}"/>`);
        updated = upsertInsideElement(updated, 'w:rPr', /<w:szCs\b[^>]*\/>/, `<w:szCs w:val="${halfPoints}"/>`);
    }

    if (override.lineSpacingTwips) {
        const rule = override.lineSpacingRule ?? 'auto';
        updated = upsertLineSpacingAttributes(updated, override.lineSpacingTwips, rule);
    }

    if (override.color) {
        updated = upsertInsideElement(updated, 'w:rPr', /<w:color\b[^>]*\/>/, `<w:color w:val="${escapeXmlAttribute(override.color)}"/>`);
    }

    if (override.shadingFill) {
        updated = upsertInsideElement(updated, 'w:pPr', /<w:shd\b[^>]*\/>/, `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXmlAttribute(override.shadingFill)}"/>`);
    }

    return updated;
}

export function insertDocxStyle(stylesXml: string, override: DocxStyleOverride): string {
    const styleType = override.styleId.endsWith('Char') ? 'character' : 'paragraph';
    const styleName = override.styleId.replace(/([a-z])([A-Z])/g, '$1 $2');
    const baseStyleXml = `<w:style w:type="${styleType}" w:customStyle="1" w:styleId="${escapeXmlAttribute(override.styleId)}"><w:name w:val="${escapeXmlAttribute(styleName)}"/></w:style>`;
    const updatedStyleXml = updateStyleXml(baseStyleXml, override);
    return stylesXml.replace(/<\/w:styles>\s*$/, `${updatedStyleXml}</w:styles>`);
}

/**
 * Apply an override to every style whose display name matches, plus the
 * style whose id matches exactly. Creates the style only when nothing
 * matched — matching by name first is what keeps this from spawning
 * duplicate styles alongside an existing heading style.
 */
export function upsertStyleOverride(stylesXml: string, override: DocxStyleOverride): string {
    const wantedNames = new Set(override.styleNames.map((name) => name.toLowerCase()));
    let matched = false;

    const updated = stylesXml.replace(STYLE_BLOCK_REGEX, (styleXml) => {
        const styleId = styleXml.match(/w:styleId="([^"]+)"/)?.[1];
        const styleName = styleXml.match(/<w:name w:val="([^"]+)"/)?.[1];

        const idMatches = styleId === override.styleId;
        const nameMatches = styleName !== undefined && wantedNames.has(styleName.toLowerCase());

        if (!idMatches && !nameMatches) {
            return styleXml;
        }

        matched = true;
        return updateStyleXml(styleXml, override);
    });

    if (matched) {
        return updated;
    }

    return insertDocxStyle(updated, override);
}

export interface StyleOverrideInput {
    styleProfile: StyleProfile;
    bodyFont: string;
    bodySizePt?: number;
    heading1Font: string;
    heading1SizePt?: number;
    heading2Font: string;
    heading2SizePt?: number;
    heading3Font: string;
    heading3SizePt?: number;
    lineSpacing?: number;
}

export function buildDocxStyleOverrides(settings: StyleOverrideInput): DocxStyleOverride[] {
    const preset: ProfilePreset = PROFILE_PRESETS[settings.styleProfile];
    const effectiveColor = preset.color;
    const bodyFont = resolveFontPair(settings.bodyFont, preset.body);
    const heading1Font = resolveFontPair(settings.heading1Font, preset.heading1);
    const heading2Font = resolveFontPair(settings.heading2Font, preset.heading2);
    const heading3Font = resolveFontPair(settings.heading3Font, preset.heading3);
    const lineSpacing = resolveLineSpacingTwips(settings.styleProfile, settings.lineSpacing);

    const overrides: DocxStyleOverride[] = [
        {
            styleId: 'Normal',
            styleNames: BODY_STYLE_NAMES,
            asciiFont: bodyFont?.ascii,
            eastAsiaFont: bodyFont?.eastAsia,
            sizePt: settings.bodySizePt ?? preset.bodySizePt,
            lineSpacingTwips: lineSpacing?.twips,
            lineSpacingRule: lineSpacing?.rule,
            color: effectiveColor
        },
        {
            styleId: 'Heading1',
            styleNames: HEADING_1_STYLE_NAMES,
            asciiFont: heading1Font?.ascii,
            eastAsiaFont: heading1Font?.eastAsia,
            sizePt: settings.heading1SizePt ?? preset.heading1SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading2',
            styleNames: HEADING_2_STYLE_NAMES,
            asciiFont: heading2Font?.ascii,
            eastAsiaFont: heading2Font?.eastAsia,
            sizePt: settings.heading2SizePt ?? preset.heading2SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading3',
            styleNames: HEADING_3_STYLE_NAMES,
            asciiFont: heading3Font?.ascii,
            eastAsiaFont: heading3Font?.eastAsia,
            sizePt: settings.heading3SizePt ?? preset.heading3SizePt,
            color: effectiveColor
        }
    ];

    if (preset.codeStyle) {
        overrides.push(...buildCodeStyleOverrides(preset.codeStyle));
    }

    return overrides.filter((override) => hasDocxStyleOverrideValue(override));
}

export function buildCodeStyleOverrides(codeStyle: CodeStyle): DocxStyleOverride[] {
    return [
        {
            styleId: 'SourceCode',
            styleNames: SOURCE_CODE_STYLE_NAMES,
            asciiFont: codeStyle.font,
            eastAsiaFont: codeStyle.font,
            sizePt: codeStyle.sizePt,
            lineSpacingTwips: Math.round(codeStyle.lineSpacing * 240),
            lineSpacingRule: 'auto',
            color: '000000',
            shadingFill: codeStyle.shadingFill
        },
        {
            styleId: 'VerbatimChar',
            styleNames: VERBATIM_CHAR_STYLE_NAMES,
            asciiFont: codeStyle.font,
            eastAsiaFont: codeStyle.font,
            sizePt: codeStyle.sizePt,
            color: '000000'
        }
    ];
}

export function hasDocxStyleOverrideValue(override: DocxStyleOverride): boolean {
    return Boolean(
        override.asciiFont
        || override.eastAsiaFont
        || override.sizePt
        || override.lineSpacingTwips
        || override.color
        || override.shadingFill
    );
}
