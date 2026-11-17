const ATX_HEADING_REGEX = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?\r?$/m;
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * Blank CommonMark fenced code blocks while preserving their line breaks.
 *
 * A closing fence may use the same character repeated at least as many times
 * as the opener. Backtick and tilde fences may be indented by up to three
 * spaces. Masking the content prevents headings inside code from becoming the
 * document title without changing offsets outside the blocks.
 */
function maskFencedCodeBlocks(markdownText: string): string {
    let fence: { character: string; length: number } | undefined;

    return markdownText.split('\n').map((line) => {
        const carriageReturn = line.endsWith('\r') ? '\r' : '';
        const content = carriageReturn ? line.slice(0, -1) : line;
        let masked = false;

        if (fence) {
            const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(content);
            if (
                closing
                && closing[1][0] === fence.character
                && closing[1].length >= fence.length
            ) {
                fence = undefined;
            }
            masked = true;
        } else {
            const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
            if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
                fence = {
                    character: opening[1][0],
                    length: opening[1].length
                };
                masked = true;
            }
        }

        return masked ? `${' '.repeat(content.length)}${carriageReturn}` : line;
    }).join('\n');
}

export function extractDocumentTitle(markdownText: string): string | undefined {
    const match = ATX_HEADING_REGEX.exec(maskFencedCodeBlocks(markdownText));
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
