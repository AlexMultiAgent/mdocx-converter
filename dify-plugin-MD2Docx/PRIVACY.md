# Privacy Notice

## Mermaid Diagram Rendering

When `mermaid_enabled` is `true` (default), this plugin sends Mermaid diagram
code blocks to the public **Mermaid Ink API** (https://mermaid.ink) for
server-side rendering. Mermaid Ink is an open-source, free service with no
authentication or rate limiting.

**What is sent:** Only the Mermaid diagram source code (plain text).

**Data sensitivity warning:** When `mermaid_enabled` is `true`, the entire content of each ` ```mermaid` code block is transmitted to the public Mermaid Ink API. Ensure Mermaid blocks in sensitive documents do not contain confidential information before enabling this feature.

**What is NOT sent:** No personal data, no document content outside Mermaid
code fences, no file metadata.

**To disable:** Set the `mermaid_enabled` parameter to `false`. Mermaid code
blocks will be preserved as plain text code blocks in the DOCX output.

## Pandoc Binary Download

On first use, this plugin uses `pypandoc` to download the Pandoc binary
(~50MB) from the official Pandoc GitHub releases. This is a one-time download
cached for subsequent invocations. No user data is transmitted during this
process.

## Temporary Files

The plugin creates temporary files during conversion (Mermaid diagram PNGs,
custom template copies). Temporary directories are created via Python's
`tempfile.mkdtemp()`, which on Windows may include the OS username in the path
(e.g., `C:\Users\<UserName>\AppData\Local\Temp\mermaid-xxxxxx\`). These
directories are cleaned up after each conversion. Error messages may
occasionally reference these paths — be mindful when sharing error output.
