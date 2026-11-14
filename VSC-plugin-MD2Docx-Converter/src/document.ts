const ATX_HEADING_REGEX = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m;
const FENCED_CODE_BLOCK_REGEX = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function extractDocumentTitle(markdownText: string): string | undefined {
    const match = ATX_HEADING_REGEX.exec(markdownText.replace(FENCED_CODE_BLOCK_REGEX, ''));
    if (!match) {
        return undefined;
    }

    const title = match[1].trim();
    return title.length > 0 ? title : undefined;
}

export function resolveDocumentTitle(markdownText: string, configuredTitle: string, markdownPath: string): string {
    const configured = configuredTitle.trim();
    if (configured) {
        return configured;
    }

    const fromHeading = extractDocumentTitle(markdownText);
    if (fromHeading) {
        return fromHeading;
    }

    const fileName = markdownPath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    return sanitizeFileName(fileName);
}

export function sanitizeFileName(name: string): string {
    const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, '_').trim();
    return cleaned.length > 0 ? cleaned : 'document';
}
