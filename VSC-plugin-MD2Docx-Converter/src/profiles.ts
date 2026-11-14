export type StyleProfile = 'template' | 'academic' | 'business' | 'technical' | 'official' | 'thesis';

export const STYLE_PROFILES: readonly StyleProfile[] = ['template', 'academic', 'business', 'technical', 'official', 'thesis'];

export interface FontPair {
    /** Latin / western font — maps to w:ascii, w:hAnsi, w:cs. */
    ascii: string;
    /** East-asian font — maps to w:eastAsia. */
    eastAsia: string;
}

/** Code-block styling, present only when the profile styles code blocks. */
export interface CodeStyle {
    font: string;
    sizePt: number;
    /** Multiple, not twips. */
    lineSpacing: number;
    shadingFill: string;
}

export interface ProfilePreset {
    body?: FontPair;
    bodySizePt?: number;
    heading1?: FontPair;
    heading1SizePt?: number;
    heading2?: FontPair;
    heading2SizePt?: number;
    heading3?: FontPair;
    heading3SizePt?: number;
    /** Monospace font, feeds pandoc `monofont`. */
    monoFont?: string;
    /** Text colour applied to body and heading styles. */
    color?: string;
    /** Code style — absent means the profile does not touch code blocks. */
    codeStyle?: CodeStyle;
    /** Line spacing multiplier — feeds pandoc `linestretch`. */
    lineSpacing?: number;
    /** Fixed line height in twips; wins over the multiplier for the DOCX layer. */
    lineSpacingTwips?: number;
    /** The line rule that goes with the spacing value. */
    lineSpacingRule?: 'auto' | 'exact';
    marginTopMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
}

export type HeadingAlignment = 'left' | 'center';

export interface ProfileLayout {
    justification: 'both' | 'left';
    indentTwips: { chinese: number; english: number };
    headingAlign: [HeadingAlignment, HeadingAlignment, HeadingAlignment];
    headingBeforeTwips: [number, number, number];
    headingAfterTwips: [number, number, number];
}

export const PROFILE_PRESETS: Record<StyleProfile, ProfilePreset> = {
    template: {},
    academic: {
        body: { ascii: 'Times New Roman', eastAsia: 'SimSun' },
        bodySizePt: 12,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading3SizePt: 12,
        color: '000000',
        lineSpacing: 1.5,
        marginTopMm: 25.4,
        marginBottomMm: 25.4,
        marginLeftMm: 31.75,
        marginRightMm: 31.75
    },
    business: {
        body: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        bodySizePt: 11,
        heading1: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading1SizePt: 18,
        heading2: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading3SizePt: 12,
        color: '000000',
        lineSpacing: 1.5,
        marginTopMm: 25.4,
        marginBottomMm: 25.4,
        marginLeftMm: 25.4,
        marginRightMm: 25.4
    },
    technical: {
        body: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        bodySizePt: 11,
        heading1: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading3SizePt: 12,
        monoFont: 'Consolas',
        color: '000000',
        codeStyle: { font: 'Consolas', sizePt: 10, lineSpacing: 1.05, shadingFill: 'F3F4F6' },
        lineSpacing: 1.35,
        marginTopMm: 19,
        marginBottomMm: 19,
        marginLeftMm: 19,
        marginRightMm: 19
    },
    official: {
        body: { ascii: 'Times New Roman', eastAsia: 'FangSong' },
        bodySizePt: 16,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Times New Roman', eastAsia: 'KaiTi' },
        heading2SizePt: 16,
        heading3: { ascii: 'Times New Roman', eastAsia: 'FangSong' },
        heading3SizePt: 16,
        color: '000000',
        lineSpacingTwips: 580,
        lineSpacingRule: 'exact',
        marginTopMm: 37,
        marginBottomMm: 35,
        marginLeftMm: 28,
        marginRightMm: 26
    },
    thesis: {
        body: { ascii: 'Times New Roman', eastAsia: 'SimSun' },
        bodySizePt: 12,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 22,
        heading2: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading2SizePt: 16,
        heading3: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading3SizePt: 14,
        color: '000000',
        lineSpacing: 1.5,
        marginTopMm: 30,
        marginBottomMm: 30,
        marginLeftMm: 30,
        marginRightMm: 30
    }
};

/** Build-time layout parameters. Only the template generator consumes these. */
export const TEMPLATE_LAYOUT: Partial<Record<StyleProfile, ProfileLayout>> = {
    academic: {
        justification: 'both',
        indentTwips: { chinese: 480, english: 0 },
        headingAlign: ['left', 'left', 'left'],
        headingBeforeTwips: [240, 200, 160],
        headingAfterTwips: [120, 100, 80]
    },
    business: {
        justification: 'both',
        indentTwips: { chinese: 440, english: 0 },
        headingAlign: ['left', 'left', 'left'],
        headingBeforeTwips: [280, 220, 180],
        headingAfterTwips: [140, 110, 90]
    },
    technical: {
        justification: 'left',
        indentTwips: { chinese: 440, english: 0 },
        headingAlign: ['left', 'left', 'left'],
        headingBeforeTwips: [200, 160, 140],
        headingAfterTwips: [100, 80, 80]
    },
    official: {
        justification: 'both',
        indentTwips: { chinese: 640, english: 0 },
        headingAlign: ['center', 'left', 'left'],
        headingBeforeTwips: [240, 120, 120],
        headingAfterTwips: [120, 60, 60]
    },
    thesis: {
        justification: 'both',
        indentTwips: { chinese: 480, english: 0 },
        headingAlign: ['center', 'left', 'left'],
        headingBeforeTwips: [360, 240, 200],
        headingAfterTwips: [180, 120, 100]
    }
};

export function normalizeStyleProfile(value: string | undefined): StyleProfile {
    const normalized = value?.trim().toLowerCase();
    return STYLE_PROFILES.includes(normalized as StyleProfile) ? (normalized as StyleProfile) : 'template';
}

/** Explicit user font wins and fills both slots; otherwise fall back to the preset pair. */
export function resolveFontPair(explicitFont: string | undefined, presetPair?: FontPair): FontPair | undefined {
    const explicit = explicitFont?.trim();
    if (explicit) {
        return { ascii: explicit, eastAsia: explicit };
    }

    return presetPair;
}

export function resolveLineSpacingTwips(
    profile: StyleProfile,
    userLineSpacing?: number
): { twips: number; rule: 'auto' | 'exact' } | undefined {
    if (userLineSpacing) {
        return { twips: Math.round(userLineSpacing * 240), rule: 'auto' };
    }

    const preset = PROFILE_PRESETS[profile];
    if (preset.lineSpacingTwips) {
        return { twips: preset.lineSpacingTwips, rule: preset.lineSpacingRule ?? 'exact' };
    }

    if (preset.lineSpacing) {
        return { twips: Math.round(preset.lineSpacing * 240), rule: 'auto' };
    }

    return undefined;
}

/** Pandoc metadata, derived from the typed preset fields — never stored twice. */
export function buildPandocMetadata(options: {
    profile: StyleProfile;
    bodyFont?: string;
    bodySizePt?: number;
    lineSpacing?: number;
}): Record<string, string> {
    const preset = PROFILE_PRESETS[options.profile];
    const metadata: Record<string, string> = {};

    const bodyFont = resolveFontPair(options.bodyFont, preset.body);
    if (bodyFont) {
        metadata.mainfont = bodyFont.ascii;
        metadata.CJKmainfont = bodyFont.eastAsia;
    }

    const bodySize = options.bodySizePt ?? preset.bodySizePt;
    if (bodySize) {
        metadata.fontsize = `${bodySize}pt`;
    }

    const lineSpacing = options.lineSpacing ?? preset.lineSpacing;
    if (lineSpacing) {
        metadata.linestretch = String(lineSpacing);
    }

    if (preset.monoFont) {
        metadata.monofont = preset.monoFont;
    }

    return metadata;
}

export function resolveMarginsMm(
    profile: StyleProfile,
    overrides: { top?: number; bottom?: number; left?: number; right?: number }
): { top?: number; bottom?: number; left?: number; right?: number } {
    const preset = PROFILE_PRESETS[profile];
    return {
        top: overrides.top ?? preset.marginTopMm,
        bottom: overrides.bottom ?? preset.marginBottomMm,
        left: overrides.left ?? preset.marginLeftMm,
        right: overrides.right ?? preset.marginRightMm
    };
}
