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

### Custom rendering endpoint

The `mermaid_api_url` parameter lets a workflow point the plugin at a
self-hosted Mermaid Ink instance. When it is set, the diagram source is sent
to **that host instead** — review where it points before using it.

The endpoint must use `http` or `https`, and link-local addresses are refused
because they cover the cloud instance metadata endpoint
(`169.254.169.254`). Private address ranges remain reachable on purpose: a
self-hosted instance commonly lives on an internal network. A hostname that
resolves to a link-local address is not detected, so do not point the
parameter at a name you do not control.

## Local images

Images referenced by the Markdown are resolved by Pandoc against the plugin's
working directory. Use an absolute path or a `data:` URI to embed an image.
An image that cannot be resolved is reported in the tool's `warnings` field
rather than being dropped silently.

## Pandoc Binary

The Pandoc binary is **bundled** inside the `pypandoc-binary` Python wheel
and extracted into the plugin venv at install time. There is **no runtime
download** from GitHub or any other host — the plugin never makes a network
request for Pandoc.

The binary is found automatically under the plugin venv at
`sys.prefix/bin/pandoc` (or `Scripts\pandoc.exe` on Windows). No
`PYPANDOC_PANDOC` environment variable is required.

If your environment is air-gapped, no action is needed — the binary
arrives with `pip install`.

## Temporary Files

The plugin creates temporary files during conversion (Mermaid diagram PNGs,
custom template copies). Temporary directories are created via Python's
`tempfile.mkdtemp()`, which on Windows may include the OS username in the path
(e.g., `C:\Users\<UserName>\AppData\Local\Temp\mermaid-xxxxxx\`). These
directories are cleaned up after each conversion. Error messages may
occasionally reference these paths — be mindful when sharing error output.
