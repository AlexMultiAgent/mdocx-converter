# Privacy Notice

## Mermaid Diagram Rendering

When `mermaid_enabled` is `true` (default), this plugin sends Mermaid diagram
code blocks to the public **Mermaid Ink API** (https://mermaid.ink) for
server-side rendering. Mermaid Ink is an open-source, free service with no
authentication or rate limiting.

**What is sent:** Only the Mermaid diagram source code (plain text).

**What is NOT sent:** No personal data, no document content outside Mermaid
code fences, no file metadata.

**To disable:** Set the `mermaid_enabled` parameter to `false`. Mermaid code
blocks will be preserved as plain text code blocks in the DOCX output.

## Pandoc Binary Download

On first use, this plugin uses `pypandoc` to download the Pandoc binary
(~50MB) from the official Pandoc GitHub releases. This is a one-time download
cached for subsequent invocations. No user data is transmitted during this
process.
