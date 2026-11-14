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

/**
 * Display names of the character styles the extension writes.
 *
 * A character style has no paragraph properties, so it never receives a
 * paragraph shading — the same rule the Dify plugin applies, where
 * python-docx's `CharacterStyle` has no `paragraph_format`.
 */
export const CHARACTER_STYLE_NAMES = ['Verbatim Char'];

/**
 * A style block is either `<w:style …>…</w:style>` or the self-closing
 * `<w:style …/>`. The attribute part is matched lazily so the trailing `/`
 * of the self-closing form is still available to the `\/>` alternative —
 * a greedy `[^>]*` would swallow it and the block would be merged with
 * the next style.
 */
const STYLE_BLOCK_REGEX = /<w:style\b[^>]*?(?:\/>|>[\s\S]*?<\/w:style>)/g;

/**
 * ECMA-376 CT_Style child order.
 *
 * Word repairs a document whose style properties are out of sequence, so a
 * new element has to be inserted at the position the schema requires
 * rather than appended to the end of its parent.
 */
const STYLE_CHILD_ORDER = [
    'w:name', 'w:aliases', 'w:basedOn', 'w:next', 'w:link', 'w:autoRedefine',
    'w:hidden', 'w:uiPriority', 'w:semiHidden', 'w:unhideWhenUsed', 'w:qFormat',
    'w:locked', 'w:personal', 'w:personalCompose', 'w:personalReply', 'w:rsid',
    'w:pPr', 'w:rPr', 'w:tblPr', 'w:trPr', 'w:tcPr', 'w:tblStylePr'
];

/** ECMA-376 CT_RPr child order. */
const RPR_CHILD_ORDER = [
    'w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps',
    'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint',
    'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing',
    'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect',
    'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang',
    'w:eastAsianLayout', 'w:specVanish', 'w:oMath'
];

/** ECMA-376 CT_PPr child order. */
const PPR_CHILD_ORDER = [
    'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr',
    'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs',
    'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct',
    'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd',
    'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents',
    'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment',
    'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr',
    'w:pPrChange'
];

export interface XmlChildSpan {
    name: string;
    start: number;
    end: number;
}

/**
 * The direct children of a whole element such as `<w:pPr …>…</w:pPr>`.
 *
 * Unlike `listStyleChildren` this keeps every child, not only the `w:`
 * prefixed ones — dropping an element would lose content rather than just
 * leave it out of the order check.
 */
function listDirectChildren(elementXml: string): XmlChildSpan[] {
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

    return listChildrenInRange(elementXml, openEnd, closeStart);
}

interface XmlTagToken {
    kind: 'open' | 'close' | 'selfclose';
    name: string;
    start: number;
    end: number;
}

interface XmlContainer {
    /** Index of the `<` of the closing tag, or the end of the string. */
    closeStart: number;
    /** The container's direct children. */
    children: XmlChildSpan[];
}

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

/**
 * Index just past the `>` that closes the tag starting at `lt`. Quoted
 * attribute values are skipped, because a value may contain a `>`.
 */
function findTagEnd(xml: string, lt: number): number {
    let quote: string | undefined;

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

function readTagName(xml: string, from: number): string {
    let i = from;
    while (i < xml.length && /[A-Za-z0-9_.:-]/.test(xml[i])) {
        i++;
    }
    return xml.slice(from, i);
}

/** Every XML tag between `from` and `to`, in document order. */
function scanXmlTags(xml: string, from: number, to: number): XmlTagToken[] {
    const tokens: XmlTagToken[] = [];
    let i = from;

    while (i < to) {
        const lt = xml.indexOf('<', i);
        if (lt < 0 || lt >= to) {
            break;
        }

        if (xml.startsWith('<!--', lt)) {
            const end = xml.indexOf('-->', lt);
            i = end < 0 ? to : end + 3;
            continue;
        }
        if (xml.startsWith('<![CDATA[', lt)) {
            const end = xml.indexOf(']]>', lt);
            i = end < 0 ? to : end + 3;
            continue;
        }
        if (xml.startsWith('<?', lt)) {
            const end = xml.indexOf('?>', lt);
            i = end < 0 ? to : end + 2;
            continue;
        }

        const end = findTagEnd(xml, lt);
        if (xml.startsWith('</', lt)) {
            tokens.push({ kind: 'close', name: readTagName(xml, lt + 2), start: lt, end });
        } else {
            const name = readTagName(xml, lt + 1);
            const selfClosing = xml[end - 2] === '/';
            tokens.push({ kind: selfClosing ? 'selfclose' : 'open', name, start: lt, end });
        }
        i = end;
    }

    return tokens;
}

/**
 * The direct children of whatever element encloses `[innerStart, innerEnd)`.
 * A nested element is folded into its parent, so only the outermost one is
 * reported.
 */
function listChildrenInRange(xml: string, innerStart: number, innerEnd: number): XmlChildSpan[] {
    const children: XmlChildSpan[] = [];
    let depth = 0;
    let open: XmlChildSpan | undefined;

    for (const token of scanXmlTags(xml, innerStart, innerEnd)) {
        if (token.kind === 'selfclose') {
            if (depth === 0) {
                children.push({ name: token.name, start: token.start, end: token.end });
            }
            continue;
        }
        if (token.kind === 'open') {
            if (depth === 0) {
                open = { name: token.name, start: token.start, end: token.end };
            }
            depth++;
            continue;
        }

        depth--;
        if (depth === 0 && open) {
            open.end = token.end;
            children.push(open);
            open = undefined;
        }
    }

    return children;
}

/**
 * List the direct children of the `<w:style>` block in `styleXml`, with their
 * positions in the string. Only top-level children are returned, so a nested
 * `<w:pPr><w:rPr>` is not mistaken for the style's own `<w:rPr>`.
 */
export function listStyleChildren(styleXml: string): XmlChildSpan[] {
    const open = /<w:style\b/.exec(styleXml);
    if (!open) {
        return [];
    }

    const lt = open.index;
    const openEnd = findTagEnd(styleXml, lt);
    if (styleXml.slice(lt, openEnd).endsWith('/>')) {
        return [];
    }

    const closeStart = styleXml.lastIndexOf('</w:style>');
    const innerEnd = closeStart >= 0 ? closeStart : styleXml.length;

    return listChildrenInRange(styleXml, openEnd, innerEnd)
        .filter((child) => child.name.startsWith('w:'));
}

function inspectContainer(xml: string): XmlContainer {
    const lt = xml.indexOf('<');
    if (lt < 0) {
        return { closeStart: xml.length, children: [] };
    }

    const openEnd = findTagEnd(xml, lt);
    const closeStart = xml.lastIndexOf('</');
    const innerEnd = closeStart >= 0 ? closeStart : xml.length;

    return { closeStart: innerEnd, children: listChildrenInRange(xml, openEnd, innerEnd) };
}

/** `<w:rPr/>` becomes `<w:rPr></w:rPr>` so a child can be inserted into it. */
function expandSelfClosingElement(xml: string): string {
    const lt = xml.indexOf('<');
    if (lt < 0) {
        return xml;
    }

    const openEnd = findTagEnd(xml, lt);
    if (!xml.slice(lt, openEnd).endsWith('/>')) {
        return xml;
    }

    const name = readTagName(xml, lt + 1);
    return xml.slice(0, openEnd - 2) + `></${name}>` + xml.slice(openEnd);
}

/**
 * Insert `childXml` into `containerXml` at the position the OOXML schema
 * requires, using `order` — the parent's ordered list of child tag names.
 * The child goes before the first existing child that follows it in the
 * schema, and after every child that precedes it.
 */
function insertChildInOrder(
    containerXml: string,
    childTagName: string,
    childXml: string,
    order: string[]
): string {
    const expanded = expandSelfClosingElement(containerXml);
    const container = inspectContainer(expanded);
    const targetIndex = order.indexOf(childTagName);

    let insertAt = container.closeStart;
    if (targetIndex >= 0) {
        let successor: XmlChildSpan | undefined;
        let successorIndex = Number.POSITIVE_INFINITY;

        for (const child of container.children) {
            const index = order.indexOf(child.name);
            if (index > targetIndex && index < successorIndex) {
                successor = child;
                successorIndex = index;
            }
        }

        if (successor) {
            insertAt = successor.start;
        }
    }

    return expanded.slice(0, insertAt) + childXml + expanded.slice(insertAt);
}

export function ensureChildElement(xml: string, tagName: string): string {
    const children = listStyleChildren(xml);
    if (children.some((child) => child.name === tagName)) {
        return xml;
    }

    return insertChildInOrder(xml, tagName, `<${tagName}/>`, STYLE_CHILD_ORDER);
}

export function upsertInsideElement(xml: string, tagName: string, childRegex: RegExp, childXml: string): string {
    const target = listStyleChildren(xml).find((child) => child.name === tagName);
    if (!target) {
        return xml;
    }

    const elementXml = xml.slice(target.start, target.end);
    const order = tagName === 'w:rPr' ? RPR_CHILD_ORDER
        : tagName === 'w:pPr' ? PPR_CHILD_ORDER
            : undefined;

    let updatedElement: string;
    if (childRegex.test(elementXml)) {
        updatedElement = elementXml.replace(childRegex, childXml);
    } else if (order) {
        const childTagName = childXml.match(/^<([A-Za-z0-9:]+)/)?.[1];
        updatedElement = childTagName
            ? insertChildInOrder(elementXml, childTagName, childXml, order)
            : elementXml.replace(/\/>$/, `>${childXml}</${tagName}>`);
    } else if (elementXml.endsWith('/>')) {
        updatedElement = elementXml.replace(/\/>$/, `>${childXml}</${tagName}>`);
    } else {
        updatedElement = elementXml.replace(new RegExp(`</${tagName}>$`), `${childXml}</${tagName}>`);
    }

    return xml.slice(0, target.start) + updatedElement + xml.slice(target.end);
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
 * attributes are touched; a missing `w:spacing` element is inserted into `w:pPr`
 * at the position the schema requires.
 */
export function upsertLineSpacingAttributes(xml: string, lineTwips: number, rule: 'auto' | 'exact'): string {
    const target = listStyleChildren(xml).find((child) => child.name === 'w:pPr');
    if (!target) {
        return xml;
    }

    const pPrXml = xml.slice(target.start, target.end);
    const spacingRegex = /<w:spacing\b[^>]*\/>/;

    let updatedPPr: string;
    if (spacingRegex.test(pPrXml)) {
        updatedPPr = pPrXml.replace(spacingRegex, (spacingXml) => {
            let updated = spacingXml;
            updated = upsertXmlAttribute(updated, 'w:line', String(lineTwips));
            updated = upsertXmlAttribute(updated, 'w:lineRule', rule);
            return updated;
        });
    } else {
        const spacingXml = `<w:spacing w:line="${lineTwips}" w:lineRule="${rule}"/>`;
        updatedPPr = insertChildInOrder(pPrXml, 'w:spacing', spacingXml, PPR_CHILD_ORDER);
    }

    return xml.slice(0, target.start) + updatedPPr + xml.slice(target.end);
}

/** A character style carries run properties only — never paragraph ones. */
function isCharacterStyle(override: DocxStyleOverride): boolean {
    const wanted = override.styleNames.map((name) => name.toLowerCase());
    if (wanted.some((name) => CHARACTER_STYLE_NAMES.some((known) => known.toLowerCase() === name))) {
        return true;
    }

    return override.styleNames.length === 0 && override.styleId.endsWith('Char');
}

export function updateStyleXml(styleXml: string, override: DocxStyleOverride): string {
    let updated = styleXml;
    const characterStyle = isCharacterStyle(override);

    updated = ensureChildElement(updated, 'w:rPr');

    if (!characterStyle && (override.lineSpacingTwips || override.shadingFill)) {
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

    if (!characterStyle && override.shadingFill) {
        updated = upsertInsideElement(updated, 'w:pPr', /<w:shd\b[^>]*\/>/, `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXmlAttribute(override.shadingFill)}"/>`);
    }

    return updated;
}

export function insertDocxStyle(stylesXml: string, override: DocxStyleOverride): string {
    const styleType = isCharacterStyle(override) ? 'character' : 'paragraph';
    const styleName = override.styleNames[0] ?? override.styleId.replace(/([a-z])([A-Z])/g, '$1 $2');
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

/**
 * Sort the children of a whole element into the order the schema requires.
 *
 * The sort is stable: a tag the order table does not know goes last and
 * keeps its place relative to the other unknown tags. An element that is
 * already in order comes back unchanged, byte for byte.
 */
function sortChildrenByOrder(elementXml: string, order: string[]): string {
    const lt = elementXml.indexOf('<');
    if (lt < 0) {
        return elementXml;
    }

    const openEnd = findTagEnd(elementXml, lt);
    if (elementXml.slice(lt, openEnd).endsWith('/>')) {
        return elementXml;
    }

    const closeStart = elementXml.lastIndexOf('</');
    if (closeStart < openEnd) {
        return elementXml;
    }

    const children = listChildrenInRange(elementXml, openEnd, closeStart);
    if (children.length < 2) {
        return elementXml;
    }

    const pieces = children.map((child, index) => {
        const gapStart = index === 0 ? openEnd : children[index - 1].end;
        const position = order.indexOf(child.name);
        return {
            text: elementXml.slice(child.start, child.end),
            gap: elementXml.slice(gapStart, child.start),
            key: position >= 0 ? position : order.length,
            index
        };
    });

    const sorted = [...pieces].sort((a, b) => (a.key - b.key) || (a.index - b.index));
    if (sorted.every((piece, position) => piece.index === position)) {
        return elementXml;
    }

    const trailing = elementXml.slice(children[children.length - 1].end, closeStart);
    const inner = sorted.map((piece) => piece.gap + piece.text).join('') + trailing;

    return elementXml.slice(0, openEnd) + inner + elementXml.slice(closeStart);
}

/**
 * Normalise one property element.
 *
 * A `w:pPr` may carry the run properties of the paragraph mark in a nested
 * `w:rPr`; those follow the run property order, not the paragraph one.
 */
function normalizePropertyElement(elementXml: string, tagName: string): string {
    const order = tagName === 'w:rPr' ? RPR_CHILD_ORDER : PPR_CHILD_ORDER;
    let normalized = sortChildrenByOrder(elementXml, order);

    if (tagName === 'w:pPr') {
        const children = listDirectChildren(normalized);
        for (let index = children.length - 1; index >= 0; index--) {
            const child = children[index];
            if (child.name !== 'w:rPr') {
                continue;
            }

            const nested = normalized.slice(child.start, child.end);
            const fixed = sortChildrenByOrder(nested, RPR_CHILD_ORDER);
            normalized = normalized.slice(0, child.start) + fixed + normalized.slice(child.end);
        }
    }

    return normalized;
}

/**
 * Normalise the run and paragraph properties of one style block.
 *
 * The block's own children — `w:name` and the rest — are left alone; only
 * the properties inside `w:rPr` and `w:pPr` are sorted.
 */
function normalizeStyleBlockOrder(styleXml: string): string {
    const children = listStyleChildren(styleXml);
    let updated = styleXml;

    // Back to front, so that the positions of the blocks still to come are
    // not invalidated by the rewrites.
    for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child.name !== 'w:rPr' && child.name !== 'w:pPr') {
            continue;
        }

        const elementXml = updated.slice(child.start, child.end);
        const normalized = normalizePropertyElement(elementXml, child.name);
        updated = updated.slice(0, child.start) + normalized + updated.slice(child.end);
    }

    return updated;
}

/**
 * Bring the run and paragraph properties of every style into the order the
 * OOXML schema requires.
 *
 * A template the user brings themselves may carry its style properties out
 * of order — Word offers to repair such a document. The Dify plugin does the
 * same with `_normalize_order`.
 */
export function normalizeDocxStyleOrder(stylesXml: string): string {
    return stylesXml.replace(STYLE_BLOCK_REGEX, (styleXml) => normalizeStyleBlockOrder(styleXml));
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
