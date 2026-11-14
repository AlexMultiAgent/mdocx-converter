# CLAUDE.md

This plugin lives in the `dify-plugin-MD2Docx/` directory of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo. The sibling `VSC-plugin-MD2Docx-Converter/` directory contains the original VS Code extension this plugin is ported from.

## Commands

```bash
pip install -r requirements.txt                                # install runtime deps
pip install -r requirements-dev.txt                            # install dev deps (pytest, dify_plugin)
python -c "import ast; ast.parse(open('src/md2docx.py', encoding='utf-8').read()); print('Syntax OK')"  # syntax check
pytest tests/ -v                                               # run test suite
```

> The syntax check needs `encoding='utf-8'`: the source contains UTF-8 punctuation and the default locale encoding on a Chinese Windows install is GBK, which raises `UnicodeDecodeError`.

Tests live in `tests/`: `smoke_test.py` (pure functions), `test_invoke.py` (Dify Tool entry with mocked deps), `test_docx_output.py` (end-to-end pandoc conversion), `test_mermaid_converter.py` (standalone Mermaid tool). `conftest.py` auto-skips when `dify_plugin` is missing.

## Architecture

This is a **Dify Tool plugin** that converts Markdown to DOCX. The plugin consists of YAML schemas + three Python modules: `src/md2docx.py` (core conversion, ~1090 lines), `src/_mermaid_render.py` (shared Mermaid HTTP client), `src/mermaid_converter.py` (standalone Mermaid tool).

### Conversion pipeline

```
markdown_content
  │
  ├─ 1. Language detection: sample first 20K chars → count CJK vs Latin → auto/en/zh
  │
  ├─ 2. Template resolution:
  │     custom_template (uploaded file) > built-in 8 ref.docx (profile × language)
  │
  ├─ 3. Mermaid preprocessing (if enabled):
  │     regex ```mermaid blocks → Mermaid Ink API (4 workers in parallel, 120s total budget)
  │     Replace blocks with ![diagram](temp.png) in markdown
  │     Falls back to preserving original code block if API fails
  │
  ├─ 4. Pandoc conversion:
  │     pypandoc.convert_text() with --reference-doc and --metadata
  │     pypandoc-binary provides pandoc at pip install time (no runtime download)
  │     Pandoc's own warnings are captured and surfaced to the caller
  │
  ├─ 5. DOCX style overrides:
  │     python-docx opens generated .docx
  │     Write the title into the core properties (dc:title)
  │     Modify Normal, Heading1-3 styles (font, size, line spacing) via lxml
  │     Technical profile: SourceCode + VerbatimChar (Consolas 10pt, color #000000, shading #F3F4F6)
  │     Page margins via section properties
  │
  └─ 6. Return: text_message + ONE json_message + blob_message(docx_bytes)
```

### File structure

```
dify-plugin-MD2Docx/
├── manifest.yaml              # Plugin metadata, runtime config
├── main.py                    # Plugin entry point
├── requirements.txt           # pypandoc-binary, python-docx, requests, lxml
├── PRIVACY.md                 # Mermaid Ink API & Pandoc download disclosure
├── _assets/
│   └── icon.svg               # Canonical icon location (manifest `icon:` points here)
├── multi-templates/           # 8 reference.docx (6 shared with VSC plugin + 2 official)
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

> A `custom_template` (`type: file`) param was REMOVED in v0.0.3. A `file`-type tool parameter makes a Dify **workflow** tool node hang in `get_workflow_tool_runtime()` and never dispatch (node stuck "running" until timeout, daemon never receives invoke). `file` params only work in Agent nodes. The `_invoke` code still tolerates a `custom_template` kwarg if present, but it is no longer exposed in the schema.

### Dify output contract

The daemon treats every `json` message as a **discrete output** — it does not merge them. A tool invocation therefore yields exactly one `json` message:

```json
{"status": "success", "stage": "complete", "file": "Report.docx", "size_kb": 12.3, "warnings": []}
```

Blob metadata is read with the key **`filename`** (not `file_name`), which the backend ignores.

### Template resolution

1. Custom uploaded `.docx` (if provided via `custom_template` parameter)
2. Built-in template from `multi-templates/` selected by `style_profile` × `reference_language`

Bundled template mapping lives in `TEMPLATE_MAP` constant. Academic, `template`, and `thesis` profiles share the same academic reference files. Technical, business, and official each have their own English/Chinese pair.

> `reference_{english,chinese}_official.docx` are byte-identical copies of the academic files — the `official` profile differs purely through its style defaults (FangSong 16pt, 1.75x, GB/T 9704 margins). They are kept as separate files so both plugins hold the same eight names.

### Language auto-detection

`detect_language()` samples the first 20,000 characters. Chinese is selected when CJK character count ≥ 40 OR > 15% of Latin letter count. Otherwise English.

### Style system (three layers)

**Layer 1 — Pandoc metadata** (`build_pandoc_metadata`): Sets `mainfont`, `CJKmainfont`, `fontsize`, `linestretch` via `--metadata`. These come from `PROFILE_METADATA` plus per-parameter overrides. A `body_font` override replaces `mainfont`; `CJKmainfont` only follows it when the override is itself a CJK font, so a Latin body font cannot take over the East Asian slot.

**Layer 2 — DOCX XML overrides** (`apply_style_overrides`): After pandoc finishes, opens the .docx via `python-docx` and modifies styles using lxml for raw XML access:

- `Normal` style — font, size, line spacing
- `Heading1`/`Heading2`/`Heading3` — font, size
- `SourceCode` (paragraph) + `VerbatimChar` (character) — Consolas 10pt, color #000000; shading #F3F4F6 on the paragraph style only
- Page margins — via `section.top_margin` etc. in python-docx

Two rules the layer depends on:

- **Style resolution is by display name.** Style ids are not portable — `a` is Normal in the English templates but List Number in the Chinese one — so body and heading styles are matched by name only. Matching by id would put the body font on list and table styles.
- **The East Asian font slot is separate.** `w:rFonts/@w:eastAsia` gets the profile's CJK font while `ascii`/`hAnsi` get the Latin font, so the `business`/`technical` presets (Arial body) do not send Chinese text to an arbitrary system fallback. A font the user named explicitly fills **both** slots — they asked for that font. `w:szCs` is written alongside `w:sz` so complex-script text keeps the same size.

  > CJK fonts are recognised by name, not by the presence of ideographs: OOXML stores the Latin names (`SimSun` is 宋体, `SimHei` is 黑体). See `CJK_FONT_NAMES`.
- **Theme fonts are removed when a font is set.** The Chinese reference templates define their headings with `w:asciiTheme="majorHAnsi"` and no explicit font; per ECMA-376 the theme attribute wins, so the override would be a silent no-op without dropping it.
- **Style properties are written in schema order.** `w:rPr` and `w:pPr` have a fixed child sequence and Word offers to repair a document whose properties are out of order. New elements are inserted at their schema position and the properties of the styles the plugin rewrites are normalised.
- **Non-`template` profiles force body and heading text to black** (`000000`). The reference templates carry Word's blue accent heading colours; Chinese formal documents use black, so the override is intentional.

**Layer 3 — Profile defaults** (`PROFILE_DEFAULTS`): Hardcoded per profile:

- `academic`: SimSun body 12pt, SimHei headings 16/14/12pt, 1.5x, margins 25.4mm
- `thesis`: SimSun body 12pt, SimHei headings 22/16/14pt (GB/T 7713), 1.5x, margins 30mm
- `business`: Arial body 11pt, Arial headings 18/14/12pt, 1.5x, margins 25.4mm (Chinese text: Microsoft YaHei)
- `technical`: Arial body 11pt, Arial headings 16/14/12pt, 1.35x, Consolas code, margins 19mm (Chinese text: Microsoft YaHei)
- `official`: FangSong body 16pt, SimHei/KaiTi/FangSong headings 16pt, 1.75x, margins 37/35/28/26mm (GB/T 9704)
- `template`: no defaults (rely on reference.docx entirely)

### Key design decisions

- **pypandoc-binary**: pandoc binary bundled in the pip package, installed at plugin init — no runtime download, no network dependency for conversion
- **No pandoc warmup**: pre-loading pandoc at import time is skipped on purpose. Spawning a subprocess before `Plugin.run()` starts the event loop can deadlock in a gevent-patched environment; the first conversion pays the cold start instead.
- **Mermaid Ink API**: Free public HTTP service for Mermaid rendering. No auth, no rate limiting. Users can disable via `mermaid_enabled: false`
- **python-docx + lxml**: Style overrides use python-docx for high-level access + lxml for raw XML manipulation when needed (fonts, spacing, shading, colors)
- **User overrides > Profile defaults**: Every style parameter can be overridden individually; `0` or empty means "use profile default"
- **Script style**: Avoiding `from __future__ import annotations` to maintain compatibility
- **Safety guards**: `markdown_content` is capped at 5 MB (`MAX_MARKDOWN_BYTES`) to prevent OOM in the Dify plugin sandbox; `mermaid_code` is capped at 256 KB (`MAX_MERMAID_CODE_BYTES`)
- **Mermaid resilience**: 3 attempts per diagram (1s/2s backoff), 4 diagrams rendered in parallel, a 120s total budget that also clamps the per-request timeout, and a 30s per-attempt ceiling. A diagram that cannot be rendered is kept as its original code block.
- **Mermaid endpoint validation**: `mermaid_api_url` must be http(s) and must not point at a link-local address (which covers the cloud metadata endpoint `169.254.169.254`). Private ranges stay allowed because a self-hosted instance commonly lives on an internal network.
- **Pandoc warnings are surfaced**: pypandoc forwards pandoc's stderr to the `pypandoc` logger; a handler installed once per process collects it so an image that could not be resolved is reported instead of being silently dropped from the DOCX. The destination lives in a `ContextVar`, because the daemon runs tool calls concurrently and a conversion must only see its own pandoc warnings.
- **Pandoc output cleanup**: `_strip_dangling_image_rels` removes image/oleObject relationships inherited from reference templates whose target files are missing, so python-docx can always open the produced DOCX
- **custom_template safety**: A `str` value for `custom_template` is rejected with a clear warning instead of being written as a corrupted binary
- **Title length**: `title` is capped at 120 characters (`MAX_TITLE_LENGTH`) because it becomes the name of the produced file

## Differences from VS Code extension

| Aspect | VS Code | Dify |
|---|---|---|
| Pandoc invocation | spawn child_process | pypandoc Python API |
| Mermaid rendering | spawn mmdc | Mermaid Ink HTTP API |
| DOCX XML editing | adm-zip raw string replace | python-docx + lxml style API |
| Temp file cleanup | `keepIntermediateFiles` setting | Always clean (ephemeral storage) |
| Output | Write to filesystem | Return blob to Dify |
| Settings | VS Code settings UI | Tool parameters |
| Code style override | Direct XML for SourceCode/VerbatimChar | python-docx style API |

## Deployment tuning (self-hosted Dify)

This section is for operators running self-hosted Dify. The Marketplace README is kept minimal and points here for the deep details.

### pip mirror for plugin env (`docker/.env`)

The plugin's Python dependencies are installed at plugin init time by the daemon. A nearby mirror makes the first install noticeably faster and avoids PyPI rate limits in CI.

```ini
# ð¨ð© China â Aliyun (recommended)
PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple/

# ð All other regions â leave empty; pip uses https://pypi.org/simple/ automatically
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

