export type ReferenceLanguage = 'english' | 'chinese';
export type ReferenceLanguageSetting = ReferenceLanguage | 'auto';

const CJK_CHAR_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const LATIN_CHAR_REGEX = /[A-Za-z]/g;

export function normalizeReferenceLanguage(value: string | undefined): ReferenceLanguage {
    return value === 'chinese' ? 'chinese' : 'english';
}

export function normalizeReferenceLanguageSetting(value: string | undefined): ReferenceLanguageSetting {
    if (value === 'auto') {
        return 'auto';
    }

    return normalizeReferenceLanguage(value);
}

export function resolveReferenceLanguage(markdownText: string, setting: ReferenceLanguageSetting): ReferenceLanguage {
    if (setting === 'english' || setting === 'chinese') {
        return setting;
    }

    return detectMarkdownLanguage(markdownText);
}

export function detectMarkdownLanguage(markdownText: string): ReferenceLanguage {
    const sample = markdownText.slice(0, 20000);
    const chineseMatches = sample.match(CJK_CHAR_REGEX)?.length ?? 0;
    const latinMatches = sample.match(LATIN_CHAR_REGEX)?.length ?? 0;

    // Prefer the Chinese template when Chinese text is materially present.
    if (chineseMatches >= 40 || chineseMatches > latinMatches * 0.15) {
        return 'chinese';
    }

    return 'english';
}
