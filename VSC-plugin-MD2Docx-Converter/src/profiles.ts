export type StyleProfile = 'template' | 'academic' | 'business' | 'technical' | 'official' | 'thesis';

export const STYLE_PROFILES: readonly StyleProfile[] = ['template', 'academic', 'business', 'technical', 'official', 'thesis'];

export interface FontPair {
    /** Latin / western font — maps to w:ascii, w:hAnsi, w:cs. */
    ascii: string;
    /** East-asian font — maps to w:eastAsia. */
    eastAsia: string;
}

export interface ProfilePreset {
    /** Pandoc metadata applied via --metadata. */
    metadata: Record<string, string>;
    body?: FontPair;
    bodySizePt?: number;
    heading1?: FontPair;
    heading1SizePt?: number;
    heading2?: FontPair;
    heading2SizePt?: number;
    heading3?: FontPair;
    heading3SizePt?: number;
    /** Line spacing multiplier — feeds pandoc `linestretch` and the `auto` line rule. */
    lineSpacing?: number;
    /** Explicit line height in twips; overrides the multiplier when present. */
    lineSpacingTwips?: number;
    /** Line spacing rule used when writing w:spacing into the DOCX. */
    lineSpacingRule?: 'auto' | 'exact';
    marginTopMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
}

export interface ProfileLayout {
    justification: 'both' | 'left';
    indentTwips: { chinese: number; english: number };
    headingAlign: ('left' | 'center')[];
    headingBeforeTwips: number[];
    headingAfterTwips: number[];
}

export const PROFILE_PRESETS: Record<StyleProfile, ProfilePreset> = {
    template: {
        metadata: {}
    },
    academic: {
        metadata: {
            mainfont: 'Times New Roman',
            CJKmainfont: 'SimSun',
            fontsize: '12pt',
            linestretch: '1.5'
        },
        body: { ascii: 'Times New Roman', eastAsia: 'SimSun' },
        bodySizePt: 12,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading3SizePt: 12,
        lineSpacing: 1.5,
        marginTopMm: 25.4,
        marginBottomMm: 25.4,
        marginLeftMm: 31.75,
        marginRightMm: 31.75
    },
    business: {
        metadata: {
            mainfont: 'Arial',
            CJKmainfont: 'Microsoft YaHei',
            fontsize: '11pt',
            linestretch: '1.5'
        },
        body: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        bodySizePt: 11,
        heading1: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading1SizePt: 18,
        heading2: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading3SizePt: 12,
        lineSpacing: 1.5,
        marginTopMm: 25.4,
        marginBottomMm: 25.4,
        marginLeftMm: 25.4,
        marginRightMm: 25.4
    },
    technical: {
        metadata: {
            mainfont: 'Arial',
            CJKmainfont: 'Microsoft YaHei',
            monofont: 'Consolas',
            fontsize: '11pt',
            linestretch: '1.35'
        },
        body: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        bodySizePt: 11,
        heading1: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading3SizePt: 12,
        lineSpacing: 1.35,
        marginTopMm: 19,
        marginBottomMm: 19,
        marginLeftMm: 19,
        marginRightMm: 19
    },
    official: {
        metadata: {
            mainfont: 'Times New Roman',
            CJKmainfont: 'FangSong',
            fontsize: '16pt',
            linestretch: '1.75'
        },
        body: { ascii: 'Times New Roman', eastAsia: 'FangSong' },
        bodySizePt: 16,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Times New Roman', eastAsia: 'KaiTi' },
        heading2SizePt: 16,
        heading3: { ascii: 'Times New Roman', eastAsia: 'FangSong' },
        heading3SizePt: 16,
        lineSpacing: 1.75,
        lineSpacingTwips: 580,
        lineSpacingRule: 'exact',
        marginTopMm: 37,
        marginBottomMm: 35,
        marginLeftMm: 28,
        marginRightMm: 26
    },
    thesis: {
        metadata: {
            mainfont: 'Times New Roman',
            CJKmainfont: 'SimSun',
            fontsize: '12pt',
            linestretch: '1.5'
        },
        body: { ascii: 'Times New Roman', eastAsia: 'SimSun' },
        bodySizePt: 12,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 22,
        heading2: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading2SizePt: 16,
        heading3: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading3SizePt: 14,
        lineSpacing: 1.5,
        marginTopMm: 30,
        marginBottomMm: 30,
        marginLeftMm: 30,
        marginRightMm: 30
    }
};

export const TEMPLATE_LAYOUT: Record<StyleProfile, ProfileLayout> = {
    template: {
        justification: 'both',
        indentTwips: { chinese: 0, english: 0 },
        headingAlign: ['left', 'left', 'left'],
        headingBeforeTwips: [0, 0, 0],
        headingAfterTwips: [0, 0, 0]
    },
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
    return STYLE_PROFILES.includes(value as StyleProfile) ? (value as StyleProfile) : 'template';
}
