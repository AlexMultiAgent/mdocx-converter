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

The endpoint must use `http` or `https`. The address of the host the plugin
runs on is refused — the loopback (`127.0.0.1`, `::1`) and the unspecified
address — as is the metadata endpoint of the common cloud providers
(`169.254.169.254`, `100.100.100.200`, `192.0.0.192`). Private address
ranges remain reachable on purpose: a self-hosted instance commonly lives on
an internal network. Hostnames are resolved before use and rejected when they
resolve to one of those addresses; HTTP redirects are not followed.

Do not point the parameter at a name you do not control. The name is resolved
once for the check and again by the HTTP client, so a resolver that answers
with a public address first and the loopback address second gets through.

## Local images

Pandoc runs with `--sandbox`. Images referenced by absolute paths, relative
paths, or external URLs are therefore not read. This prevents user-provided
Markdown from probing the host filesystem or making arbitrary outbound HTTP
requests. Use a `data:` URI to embed an image. An image that cannot be read is
reported in the tool's `warnings` field rather than being dropped silently.

## Pandoc Binary

The Pandoc binary is **bundled** inside the `pypandoc-binary` Python wheel
and extracted into the plugin venv at install time. There is **no runtime
download** from GitHub or any other host — the plugin never makes a network
request for Pandoc.

The binary is found automatically under the plugin venv at
`sys.prefix/bin/pandoc` (or `Scripts\pandoc.exe` on Windows). No
`PYPANDOC_PANDOC` environment variable is required.

If your environment is air-gapped, no action is needed — the binary
arrives with `pip install`. Pandoc itself is not given network access when it
processes Markdown.

## Temporary Files

The plugin creates temporary files during conversion (Mermaid diagram PNGs,
custom template copies). Temporary directories are created via Python's
`tempfile.mkdtemp()`, which on Windows may include the OS username in the path
(e.g., `C:\Users\<UserName>\AppData\Local\Temp\mermaid-xxxxxx\`). These
directories are cleaned up after each conversion, including a failed one. The
paths stay in the plugin log and are not part of the error the tool returns.

Pandoc diagnostics are drained into a bounded buffer (1 MB). Filesystem and
write failures are logged with their full exception and returned to the caller
only as a generic temporary-file error, so server paths are not disclosed.

## Resource Limits

Markdown input is capped at 5 MB and 5,000 image references. Mermaid rendering
is capped at 50 diagrams and 32 MB of rendered PNG data. A complete request is
budgeted to 165 seconds inside the plugin's 180-second connection lifetime.
