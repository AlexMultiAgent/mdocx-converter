import * as path from 'path';
import type { ReferenceLanguage } from './language';
import type { StyleProfile } from './profiles';

export const BUNDLED_REFERENCE_DOCX: Record<StyleProfile, Record<ReferenceLanguage, string>> = {
    template: {
        english: path.join('multi-templates', 'reference_english_academic.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_academic.docx')
    },
    academic: {
        english: path.join('multi-templates', 'reference_english_academic.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_academic.docx')
    },
    business: {
        english: path.join('multi-templates', 'reference_english_business.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_business.docx')
    },
    technical: {
        english: path.join('multi-templates', 'reference_english_technical.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_technical.docx')
    },
    official: {
        english: path.join('multi-templates', 'reference_english_official.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_official.docx')
    },
    thesis: {
        english: path.join('multi-templates', 'reference_english_thesis.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_thesis.docx')
    }
};

export function getBundledReferenceDocxCandidates(
    extensionPath: string,
    referenceLanguage: ReferenceLanguage,
    styleProfile: StyleProfile
): string[] {
    const primary = BUNDLED_REFERENCE_DOCX[styleProfile][referenceLanguage];
    return [path.join(extensionPath, primary)];
}
