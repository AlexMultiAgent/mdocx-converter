# CLAUDE.md

This plugin lives in the `dify-plugin-MD2Docx/` directory of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo. The sibling `VSC-plugin-MD2Docx-Converter/` directory contains the original VS Code extension this plugin is ported from.

## Commands

```bash
pip install -r requirements.txt                                # install runtime deps
pip install -r requirements-dev.txt                            # install dev deps (pytest, dify_plugin)
python -c "import ast; ast.parse(open('src/md2docx.py', encoding='utf-8').read()); print('Syntax OK')"  # syntax check
pytest tests/ -v                                               # run test suite
python scripts/package.py --output MD2Docx.difypkg             # build deterministic package
$env:RUN_LIVE_MERMAID="1"; pytest tests/test_mermaid_live.py -v # optional public API check
```

> The syntax check needs `encoding='utf-8'`: the source contains UTF-8 punctuation and the default locale encoding on a Chinese Windows install is GBK, which raises `UnicodeDecodeError`.

Tests live in `tests/`: `smoke_test.py` (pure functions), `test_invoke.py` (Dify Tool entry with mocked deps), `test_docx_output.py` (end-to-end pandoc conversion plus security/limits), `test_mermaid_converter.py` (standalone Mermaid tool), `test_mermaid_api_url.py` (the endpoint filter), `test_robustness.py` (the pandoc time limit, the cleanup after a failure, the error hygiene and the boolean coercion), `test_packaging.py` (archive contract), and `test_mermaid_live.py` (opt-in public API integration). `conftest.py` auto-skips when `dify_plugin` is missing.

## Architecture

This is a **Dify Tool plugin** that converts Markdown to DOCX. The plugin consists of YAML schemas + three Python modules: `src/md2docx.py` (core conversion, ~1450 lines), `src/_mermaid_render.py` (shared Mermaid HTTP client), `src/mermaid_converter.py` (standalone Mermaid tool).

### Conversion pipeline

```
markdown_content
  │
  ├─ 1. Language detection: sample first 20K chars → count CJK vs Latin → auto/en/zh
  │
  ├─ 2. Template resolution:
  │     custom_template (uploaded file) > built-in 10 ref.docx (profile × language)
  │
  ├─ 3. Mermaid preprocessing (if enabled):
  │     regex ```mermaid blocks → Mermaid Ink API (4 workers, 75s total budget)
  │     Replace blocks with data:image/png URIs in markdown
  │     Falls back to preserving original code block if API fails
  │
  ├─ 4. Pandoc conversion:
  │     the pandoc binary with --sandbox, --reference-doc and --metadata, and a timeout
  │     pypandoc-binary provides pandoc at pip install time (no runtime download)
  │     Pandoc's own warnings are captured and surfaced to the caller
  │
  ├─ 5. DOCX style overrides:
  │     python-docx opens generated .docx
  │     Write the title into the core properties (dc:title)
  │     Modify Normal, Heading1-3 styles (font, size, line spacing) via lxml
  │     Code styles: SourceCode + VerbatimChar (Consolas 10pt, color #000000; shading and
  │     line spacing where the profile declares them)
  │     Page margins via section properties
  │
  └─ 6. Return: text_message + ONE json_message + blob_message(docx_bytes)
```

### File structure

```
dify-plugin-MD2Docx/
├── manifest.yaml              # Plugin metadata, runtime config
├── main.py                    # Plugin entry point
├── requirements.txt           # dify_plugin, pypandoc-binary, python-docx, requests, lxml
├── PRIVACY.md                 # Mermaid Ink API & Pandoc download disclosure
├── README.md                  # English marketplace README — shipped
├── readme/
│   └── README_zh_Hans.md      # Chinese marketplace README — shipped
├── requirements-dev.txt       # pytest, dify_plugin — excluded from the package itself
├── pytest.ini                 # The `slow` and `integration` markers — excluded from the package itself
├── scripts/package.py         # .difypkg builder (excluded from the package itself)
├── icon.svg                   # Referenced by manifest `icon:` — keep byte-identical to _assets/icon.svg
├── _assets/
│   └── icon.svg               # Canonical icon location (the marketplace check resolves _assets/<icon>)
├── multi-templates/           # 10 reference.docx (5 profiles x 2 languages) — copied from the VSC plugin by scripts/sync-templates.sh
├── provider/
│   ├── md2docx.py             # Md2DocxProvider (ToolProvider)
│   └── md2docx.yaml           # Tool Provider declaration
├── tools/
│   ├── md_to_docx.yaml        # Core tool — 6 parameters
│   ├── md_to_docx_advanced.yaml  # Advanced tool — 19 parameters
│   └── mermaid_converter.yaml # Standalone Mermaid → PNG — 2 parameters
└── src/
    ├── __init__.py
    ├── md2docx.py             # Core conversion — Md2DocxTool
    ├── _mermaid_render.py     # Shared Mermaid client (no Tool subclass)
    └── mermaid_converter.py   # MermaidConverterTool
```

### Tool parameters

**Markdown to DOCX (6):** `markdown_content` (req, llm), `title` (opt, llm), `style_profile` (select, form; 6 options: academic/thesis/technical/business/official/template), `reference_language` (select, form), `mermaid_enabled` (boolean, form, default: true), `mermaid_api_url` (string, form)

**Markdown to DOCX (Advanced) (19):** the 6 above plus `body_font`, `body_size_pt`, `line_spacing`, `margin_top_mm`, `margin_bottom_mm`, `margin_left_mm`, `margin_right_mm`, `heading1_font`, `heading1_size_pt`, `heading2_font`, `heading2_size_pt`, `heading3_font`, `heading3_size_pt`.

**Mermaid to Image (2):** `mermaid_code` (req, llm), `mermaid_api_url` (string, form).

> A `custom_template` (`type: file`) param is **not exposed in any tool schema** — no published version has it. A `file`-type tool parameter makes a Dify **workflow** tool node hang in `get_workflow_tool_runtime()` and never dispatch (node stuck "running" until timeout, daemon never receives invoke). `file` params only work in Agent nodes. The `_invoke` code still tolerates a `custom_template` kwarg if present, but it is not in the schema.

### Dify output contract

The daemon treats every `json` message as a **discrete output** — it does not merge them. A tool invocation therefore yields exactly one `json` message:

```json
{"status": "success", "stage": "complete", "file": "Report.docx", "size_kb": 12.3, "warnings": []}
```

Blob metadata is read with the key **`filename`** (not `file_name`), which the backend ignores.

### Template resolution

1. Custom uploaded `.docx` (if a `custom_template` value is passed — the parameter is not exposed in the schema)
2. Built-in template from `multi-templates/` selected by `style_profile` × `reference_language`

Bundled template mapping lives in the `TEMPLATE_MAP` constant. Academic, technical, business, official and thesis each have their own English/Chinese pair; only the `template` profile reuses the academic reference files.

> The ten templates are generated from one declarative style table by the VS Code side's `scripts/build-templates.js` and copied over by `scripts/sync-templates.sh`. The VS Code plugin is the source of truth — regenerate there and re-sync rather than hand-editing a .docx.

### Language auto-detection

`detect_language()` samples the first 20,000 characters. Chinese is selected when CJK character count ≥ 40 OR > 15% of Latin letter count. Otherwise English.

### Style system (three layers)

**Layer 1 — Pandoc metadata** (`build_pandoc_metadata`): Sets `mainfont`, `CJKmainfont`, `fontsize`, `linestretch` via `--metadata`. `PROFILE_METADATA` is derived from `PROFILE_DEFAULTS`, eliminating a second hand-maintained preset table, then per-parameter overrides are applied. A `body_font` override replaces **both** `mainfont` and `CJKmainfont` — the user named that font explicitly, so it fills both slots. A profile that pins a fixed line height (`official`) contributes no `linestretch`; the twips are written by Layer 2.

> ⚠️ **Layer 1 never reaches the output.** Pandoc's docx writer ignores `mainfont` / `CJKmainfont` / `fontsize` / `linestretch` once a `--reference-doc` is supplied: with any of the 10 bundled templates, `word/document.xml` and `word/styles.xml` come out **byte-identical** with and without the metadata — only `docProps/custom.xml` records it. The reference template's own `docDefaults` set the base font, so **Layer 2 is what actually formats the document**. Change `PROFILE_DEFAULTS`; both layers now derive from that one table.

**Layer 2 — DOCX XML overrides** (`apply_style_overrides`): After pandoc finishes, opens the .docx via `python-docx` and modifies styles using lxml for raw XML access:

- `Normal` style — font, size, line spacing
- `Heading1`/`Heading2`/`Heading3` — font, size
- `SourceCode` (paragraph) + `VerbatimChar` (character) — Consolas 10pt, color #000000; the shading (#F3F4F6 for `technical` and `thesis`) and the line spacing (1.05 for `technical`, 1.15 for the others) on the paragraph style only. The values come from the `code_style` entry of `PROFILE_DEFAULTS`, which the parity gate compares with the VS Code preset table.
- Page margins — via `section.top_margin` etc. in python-docx

Rules the layer depends on:

- **Style resolution is by display name.** Style ids are not portable — Word mints them arbitrarily when a template is saved (`a` was Normal in one of the old English templates but List Number in the Chinese one) — so body and heading styles are matched by name only. Matching by id would put the body font on list and table styles.
- **Latin, East Asian, and complex-script slots are separate.** `w:rFonts/@w:ascii` and `w:hAnsi` get the profile's Latin font, `w:eastAsia` gets its CJK font, and `w:cs` gets the Latin face for complex scripts. A font the user named explicitly fills all slots — they asked for that font. `w:szCs` is written alongside `w:sz` so complex-script text keeps the same size.

- **Theme fonts are removed when a font is set.** Some reference templates define their headings with `w:asciiTheme="majorHAnsi"` and no explicit font; per ECMA-376 the theme attribute wins, so the override would be a silent no-op without dropping it.
- **Style properties are written in schema order.** `w:rPr` and `w:pPr` have a fixed child sequence and Word offers to repair a document whose properties are out of order. New elements are inserted at their schema position and the properties of the styles the plugin rewrites are normalised.
- **Non-`template` profiles force body and heading text to black** (`000000`). The reference templates carry Word's blue accent heading colours; Chinese formal documents use black, so the override is intentional.

**Layer 3 — Profile defaults** (`PROFILE_DEFAULTS`): Hardcoded per profile:

- `academic`: Times New Roman / SimSun body 12pt, Times New Roman / SimHei headings 16/14/12pt, 1.5x, margins 25.4/25.4/31.75/31.75mm
- `thesis`: Times New Roman / SimSun body 12pt, Times New Roman / SimHei headings 22/16/14pt (GB/T 7713), 1.5x, margins 30mm
- `business`: Arial / Microsoft YaHei body 11pt, Arial / Microsoft YaHei headings 18/14/12pt, 1.5x, margins 25.4mm
- `technical`: Arial / Microsoft YaHei body 11pt, Arial / Microsoft YaHei headings 16/14/12pt, 1.35x, Consolas code, margins 19mm
- `official`: Times New Roman / FangSong body 16pt, Times New Roman / SimHei, KaiTi, FangSong headings 16pt, fixed 29pt line height (`w:line="580"`, `w:lineRule="exact"`, GB/T 9704), margins 37/35/28/26mm
- `template`: no defaults (rely on reference.docx entirely)

> `official` pins its line height in twips instead of a multiplier — GB/T 9704 asks for a fixed 29pt, which `linestretch` cannot express. The pandoc layer therefore carries **no** `linestretch` for this profile; `_resolve_line_spacing()` returns `(580, "exact")` for the DOCX layer. A user-supplied `line_spacing` still wins and switches back to a multiple.

### Key design decisions

- **pypandoc-binary**: pandoc binary bundled in the pip package, installed at plugin init — no runtime download, no network dependency for conversion
- **No pandoc warmup**: pre-loading pandoc at import time is skipped on purpose. Spawning a subprocess before `Plugin.run()` starts the event loop can deadlock in a gevent-patched environment; the first conversion pays the cold start instead.
- **Mermaid Ink API**: Free public HTTP service for Mermaid rendering. No auth, no rate limiting. Users can disable via `mermaid_enabled: false`
- **python-docx + lxml**: Style overrides use python-docx for high-level access + lxml for raw XML manipulation when needed (fonts, spacing, shading, colors)
- **User overrides > Profile defaults**: Every style parameter can be overridden individually; `0` or empty means "use profile default"
- **Script style**: Avoiding `from __future__ import annotations` to maintain compatibility
- **Safety guards**: `markdown_content` is capped at 5 MB; Mermaid is capped at 50 diagrams and 32 MB total rendered PNG data; `mermaid_code` is capped at 256 KB. Numeric overrides have runtime bounds in addition to YAML `min`/`max`.
- **Mermaid resilience**: retry only transient failures (network, 408/425/429, 5xx), with 1s/2s bounded backoff, 4 diagrams in parallel, a 75s total budget, and a 30s per-attempt ceiling. A request cannot sleep past its deadline. A diagram that cannot be rendered is kept as its original code block.
- **Mermaid endpoint validation**: `mermaid_api_url` must be http(s), contain no query/fragment, and must not point at the host the plugin runs on — the loopback and the unspecified address (in the IPv4, the IPv4-mapped and the IPv4-compatible forms), the link-local range and the cloud metadata endpoints of AWS, Azure, Google, Alibaba and Oracle are refused, both as a literal address and after the name is resolved. The URL is checked again right before the request, because the name may have been re-pointed in between. HTTP redirects are not followed. Private ranges stay allowed because a self-hosted instance commonly lives on an internal network.

  > ⚠️ **A name that re-points between the check and the request is not covered.** The name is resolved once for the check and again by the HTTP client, so a resolver that answers with a public address first and the loopback address second gets through. Pinning the address would break a self-hosted instance behind HTTPS, where the certificate belongs to the name and not to the address. The loopback and the metadata ranges are therefore refused as a literal address as well — that is what closes the everyday case.
- **Pandoc is sandboxed**: `--sandbox` blocks URL fetches and arbitrary local-file reads from user Markdown. Mermaid PNGs are embedded as data URIs so they still work. User-supplied images must also use data URIs.
- **Pandoc has a time limit**: pypandoc cannot be given a timeout, so pandoc is started directly with one (`PANDOC_TIMEOUT_SECONDS`, 300 s). Its stderr is routed to the `pypandoc` logger exactly as pypandoc does it, so the collected pandoc warnings keep working. The worst case the guards allow — 5 MB of Markdown plus 32 MB of rendered PNG, inlined as data URIs — takes pandoc about 80 s, which is why the ceiling is 300 s.
- **The caller never sees a path of the server**: a pandoc failure is reported by its kind, and the raw message — the call stack of pandoc and the paths of the machine — stays in the log.
- **Pandoc warnings are surfaced**: the stderr of pandoc is routed to the `pypandoc` logger, the same way pypandoc does it; a handler installed once per process collects it so an image that could not be resolved is reported instead of being silently dropped from the DOCX. The destination lives in a `ContextVar`, because the daemon runs tool calls concurrently and a conversion must only see its own pandoc warnings.
- **Pandoc output cleanup**: `_strip_dangling_image_rels` removes image/oleObject relationships inherited from reference templates whose target files are missing, so python-docx can always open the produced DOCX
- **custom_template safety**: A `str` value for `custom_template` is rejected with a clear warning instead of being written as a corrupted binary
- **Title sanitising**: `title` becomes the name of the produced file, so `sanitize_filename()` replaces the characters that are illegal in a file name (`<>:"/|?*` plus control characters) with `_`, trims, truncates to 120 characters (`MAX_TITLE_LENGTH`), and falls back to `"Document"`. The sanitised name is what the JSON `file` field and the blob `filename` carry.
- **Boolean coercion**: Dify form parameters arrive as strings, so `mermaid_enabled` is read through `_coerce_bool()`, which treats `"false"`, `"0"`, `"no"`, `"off"`, `"disabled"`, `"n"` and `""` as False. A plain truthiness check would keep Mermaid **on** for `mermaid_enabled: "false"`. A parameter that is not there at all (`null`) keeps the default of the schema, so a workflow that serialises it to null does not silently switch the rendering off.

## Differences from VS Code extension

| Aspect | VS Code | Dify |
|---|---|---|
| Pandoc invocation | spawn child_process | the pandoc binary, with a timeout |
| Mermaid rendering | spawn mmdc, falling back to the Mermaid Ink API when mmdc is missing | Mermaid Ink HTTP API |
| Image handling | local paths and URLs resolve (`--resource-path`) | `--sandbox`: only `data:` URIs resolve |
| DOCX XML editing | adm-zip raw string replace | python-docx + lxml style API |
| Temp file cleanup | `keepIntermediateFiles` setting | Always clean (ephemeral storage) |
| Output | Write to filesystem | Return blob to Dify |
| Settings | VS Code settings UI | Tool parameters |
| Code style override | Direct XML for SourceCode/VerbatimChar | python-docx style API |

## Publishing to the Dify Marketplace

The marketplace lives in `langgenius/dify-plugins`; the fork is `AlexMultiAgent/dify-plugins`. The flow: commit and push the source here first, then commit the built `.difypkg` to `AlexMultiAgent/md2docx/MD2Docx.difypkg` on a branch of the fork, and open a PR against `langgenius/dify-plugins:main`. **A version-update PR changes exactly one `.difypkg` file.**

### The pre-check CI rejects the PR unless

- `manifest.yaml` has **`contact`** — a valid email address.
- `manifest.yaml` has a top-level **`network.domains`** list covering every host the plugin can reach (currently just `mermaid.ink`; the scanner also matches URLs quoted in a tool YAML's `human_description`).
- `requirements.txt` pins **`dify_plugin>=0.9.0`**.
- The PR body has a **`## Local validation`** section and a **`## Security and privacy notes`** section. The latter may not read "None/N/A" when the scanner found filesystem or network capabilities — disclose the temporary-file writes and the outbound host.
- The PR body is **English only** (CJK outside code blocks is rejected) and carries the info fields Author / Plugin name / Version / Source repository / Contact, both submission-type checkboxes, and a risk level.

The validators live in `langgenius/dify-marketplace-toolkit` under `toolkit/checks/*.py` — read them there for the exact rules.

### Check the PR locally before opening it

The marketplace's own validators run on the package and on the PR body, so a missing piece is found in seconds instead of in a CI round of ~15 minutes:

```bash
git clone --depth=1 git@github.com:langgenius/dify-marketplace-toolkit.git
cd dify-marketplace-toolkit
python validator/validate-difypkg.py <path>.difypkg \
  --pr-body-file <pr-body.md> --output-dir <report-dir>
```

It reports `Blocking failures: 0` and writes `summary.md`. The checks that need GitHub metadata are skipped in the local run — cover them by hand with `validator/check-pr-body.py` and `validator/check-pr-review-notes.py`.

Two traps on Windows: the toolkit needs the **real `yq`** (the pip `yq` package is a wrapper around `jq` and fails without it — put the `yq` binary first on `PATH`), and `PYTHONIOENCODING=utf-8` keeps the validator from dying on a GBK console while it prints the findings. A checkout of the toolkit that was patched by hand can also carry a broken `toolkit/checks/manifest.py` — `git status` in the clone and `git checkout -- <file>` restores the upstream version.

### Packaging without the CLI

`dify-plugin-cli` is not on PyPI, so `dify-plugin plugin package` is unavailable. Build with the checked-in script:

```bash
python scripts/package.py --output MD2Docx.difypkg
```

The script walks this directory, applies `.difyignore`, keeps `.difyignore` itself, sorts entries by ASCII path, writes them with `ZIP_DEFLATED` and no directory entries, and refuses to build unless every entry in `REQUIRED_ENTRIES` is present (manifest, `main.py`, both icons, the three tool YAMLs, the three `src/` modules). The entry **order and contents** are reproducible, but each zip entry embeds the source file's mtime — two builds of the same tree are **not** byte-identical. CI builds and uploads the package for both the minimum supported SDK and the current tested SDK.

The daemon rejects a package whose **uncompressed** size exceeds `MAX_PLUGIN_PACKAGE_SIZE` (50 MB by default, `internal/types/app/default.go` in `dify-plugin-daemon`). The current package is ~140 KB compressed / ~220 KB uncompressed — never vendor the Pandoc binary into it.

## Deployment tuning (self-hosted Dify)

This section is for operators running self-hosted Dify. The Marketplace README is kept minimal and points here for the deep details.

### pip mirror for plugin env (`docker/.env`)

The plugin's Python dependencies are installed at plugin init time by the daemon. A nearby mirror makes the first install noticeably faster and avoids PyPI rate limits in CI.

```ini
# 🇨🇳 China — Aliyun (recommended)
PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple/

# 🌐 All other regions — leave empty; pip uses https://pypi.org/simple/ automatically
# PIP_MIRROR_URL=
```

If you set an HTTP mirror (rare), also add it to `PIP_TRUSTED_HOST`:

```ini
PIP_TRUSTED_HOST=mirrors.aliyun.com
```

After editing `docker/.env`: `docker compose down && docker compose up -d`.

Verify the env reached the daemons:

```bash
docker exec docker-plugin_daemon-1 env | grep PIP_MIRROR_URL
docker exec docker-sandbox-1        env | grep PIP_MIRROR_URL
```

### Sandbox timeouts (optional)

The plugin loads ~5 packages (`dify_plugin`, `pypandoc-binary`, `python-docx`, `requests`, `lxml`) on first install. In slow networks bump the init timeout:

```ini
PLUGIN_PYTHON_ENV_INIT_TIMEOUT=720   # default 120s
PLUGIN_MAX_EXECUTION_TIMEOUT=1800    # default 600s
```

### Pandoc availability

`pypandoc-binary` ships the pandoc binary inside the pip wheel, so no GitHub download is needed. If the runner is air-gapped, the binary is extracted under the plugin's venv (`sys.prefix/bin/pandoc` or `Scripts\pandoc.exe` on Windows) and is found automatically. No `PYPANDOC_PANDOC` env var is required.

If you ever see a `FileNotFoundError` for `pandoc`, check that the wheel installed correctly:

```bash
python -c "import pypandoc; print(pypandoc.get_pandoc_version())"
```

## Verifying against a live Dify instance

`pytest` covers the pipeline, but the plugin only works for real inside a running Dify. These paths need no console login.

**Install / upgrade** — plugin daemon at `http://plugin_daemon:5002`, header `X-Api-Key: $PLUGIN_DAEMON_KEY` (from the Dify install's `docker/.env`):
- `POST /plugin/{tenant_id}/management/install/upload/package` (multipart field `dify_pkg`) → returns `plugin_unique_identifier`.
- `POST /plugin/{tenant_id}/management/install/identifiers` returns `all_installed: true` when the plugin is already installed and **changes nothing** — use `.../management/install/upgrade` (`original_plugin_unique_identifier` / `new_plugin_unique_identifier`) to move to a new version. The upgrade needs **`source`** as well, or the daemon rejects the request on a missing `Source` field.
- `POST /plugin/{tenant_id}/dispatch/tool/invoke` invokes a tool: `X-Plugin-ID: <author>/<name>`, `data.provider`, `data.tool`, `data.credential_type: unauthorized` (this plugin has no credentials). The body also needs **`"credentials": {}`** — the daemon validates that field as a dictionary and a missing one fails with a pydantic error.

⚠️ **The new version does not serve requests right away.** The daemon builds the venv first ("pre-compiling plugin"), then starts a new local runtime ("local runtime ready"), and only then does the session point at the new identifier — about a minute after the upgrade returns. **A test that runs in between is silently served by the old version**, which reads like the new code misbehaving: the 0.0.4 build tried to connect to a refused Mermaid endpoint, and it looked like the 0.0.5 filter was broken. Check which version answered before trusting a result:

```bash
docker exec docker-plugin_daemon-1 sh -c \
  "grep -o 'plugin_unique_identifier=alexmultiagent/md2docx:[^ ]*' /app/logs/server.log | tail -5"
```

The session lines carry the `plugin_unique_identifier=` that served the call. The plugin itself runs in the **daemon** container, not in the sandbox — its venv is at `/app/storage/cwd/<author>/<name>-<version>@<hash>/.venv`.

**Blob chunks are base64-encoded individually.** Decode each chunk on its own and concatenate the bytes in `sequence` order; joining the base64 strings and decoding once yields garbage. `total_length` on the first chunk is the expected size.

**Console API** (`/console/api`, needs the workspace owner's account): the password goes over the wire base64-encoded, auth is cookie-based (not `Authorization: Bearer` — that is the service API's scheme), and every request needs the `csrf_token` cookie **plus** an `X-CSRF-Token` header; without it even GETs return 401.

**Workflow tool node** — a plugin tool inside a workflow needs three things the tool schema does not describe:
- `data.tool_node_version: "2"`. Without it the node takes the legacy path and hands the tool the raw `{value, type}` envelope — `tool parameter <name> value {...} not in options [...]`.
- `data.tool_parameters` holds the tool's `llm` inputs (e.g. `markdown_content`); `data.tool_configurations` holds its `form` parameters (e.g. `style_profile`). The runtime merges the two, `tool_parameters` winning on name collisions.
- an **end node** whose `outputs` point at the tool node (`value_selector: ["<node id>", "files"]`). Without it `POST /v1/workflows/run` returns `data.outputs: {}` even though the tool succeeded.

A boolean `form` parameter reaches the plugin as the **string** `"False"` (Dify stringifies the value), so `_coerce_bool` must keep lowercasing before matching `_FALSY_STRINGS`.
