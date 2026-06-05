# CLAUDE.md

This plugin lives in the `dify-plugin-MD2Docx/` directory of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo. The sibling `VSC-plugin-MD2Docx-Converter/` directory contains the original VS Code extension this plugin is ported from.

## Commands

```bash
pip install -r requirements.txt                                # install runtime deps
pip install -r requirements-dev.txt                            # install dev deps (pytest, dify_plugin)
python -c "import ast; ast.parse(open('src/md2docx.py').read()); print('Syntax OK')"  # syntax check
pytest tests/ -v                                               # run test suite
```

Tests live in `tests/`: `smoke_test.py` (pure functions), `test_invoke.py` (Dify Tool entry with mocked deps), `test_docx_output.py` (end-to-end pandoc conversion). `conftest.py` auto-skips when `dify_plugin` is missing.

## Architecture

This is a **Dify Tool plugin** that converts Markdown to DOCX. The plugin consists of YAML schemas + a single Python file: `src/md2docx.py` (~744 lines).

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
  │     regex ```mermaid blocks → Mermaid Ink API (parallel, 4 workers) → PNG bytes → temp file
  │     Replace blocks with ![diagram](temp.png) in markdown
  │     Falls back to preserving original code block if API fails
  │
  ├─ 4. Pandoc conversion:
  │     pypandoc.convert_text() with --reference-doc and --metadata
  │     pypandoc-binary provides pandoc at pip install time (no runtime download)
  │
  ├─ 5. DOCX style overrides:
  │     python-docx opens generated .docx
  │     Modify Normal, Heading1-3 styles (font, size, line spacing) via lxml
  │     Technical profile: SourceCode + VerbatimChar (Consolas 10pt, color #000000, shading #F3F4F6)
  │     Page margins via section properties
  │
  └─ 6. Return: text_message + blob_message(docx_bytes)
```

### File structure

```
dify-plugin-MD2Docx/
├── manifest.yaml              # Plugin metadata, runtime config
├── requirements.txt           # pypandoc-binary, python-docx, requests, lxml
├── PRIVACY.md                 # Mermaid Ink API & Pandoc download disclosure
├── icon.svg                   # CLI requires root-level copy (also in _assets/)
├── _assets/
│   └── icon.svg               # Canonical icon location
├── multi-templates/           # 8 reference.docx (6 shared with VSC plugin + 2 official)
├── provider/
│   ├── md2docx.py             # Md2DocxProvider (ToolProvider)
│   └── md2docx.yaml           # Tool Provider declaration
├── tools/
│   └── md_to_docx.yaml        # Tool parameter schema (18 parameters)
└── src/
    ├── __init__.py
    └── md2docx.py              # Core conversion — all logic in one file
```

### Tool parameters (18 total)

**Core (4):** `markdown_content` (req, llm), `title` (opt, llm), `style_profile` (select, form; 6 options: academic/thesis/technical/business/official/template), `reference_language` (select, form)

> A `custom_template` (`type: file`) param was REMOVED in v0.0.3. A `file`-type tool parameter makes a Dify **workflow** tool node hang in `get_workflow_tool_runtime()` and never dispatch (node stuck "running" until timeout, daemon never receives invoke). `file` params only work in Agent nodes. The `_invoke` code still tolerates a `custom_template` kwarg if present, but it is no longer exposed in the schema.

**Extended (1):** `mermaid_enabled` (boolean, form, default: true)

**Advanced (13):** `body_font`, `body_size_pt`, `line_spacing`, `margin_top_mm`, `margin_bottom_mm`, `margin_left_mm`, `margin_right_mm`, `heading1_font`, `heading1_size_pt`, `heading2_font`, `heading2_size_pt`, `heading3_font`, `heading3_size_pt`

### Template resolution

1. Custom uploaded `.docx` (if provided via `custom_template` parameter)
2. Built-in template from `multi-templates/` selected by `style_profile` × `reference_language`

Bundled template mapping lives in `TEMPLATE_MAP` constant. Academic, `template`, and `thesis` profiles share the same academic reference files. Technical, business, and official each have their own English/Chinese pair.

### Language auto-detection

`detect_language()` samples the first 20,000 characters. Chinese is selected when CJK character count ≥ 40 OR > 15% of Latin letter count. Otherwise English.

### Style system (three layers)

**Layer 1 — Pandoc metadata** (`build_pandoc_metadata`): Sets `mainfont`, `CJKmainfont`, `fontsize`, `linestretch` via `--metadata`. These come from `PROFILE_METADATA` plus per-parameter overrides.

**Layer 2 — DOCX XML overrides** (`apply_style_overrides`): After pandoc finishes, opens the .docx via `python-docx` and modifies styles using lxml for raw XML access:

- `Normal` style — font, size, line spacing
- `Heading1`/`Heading2`/`Heading3` — font, size
- `SourceCode` + `VerbatimChar` (technical profile only) — Consolas 10pt, color #1F2937
- Page margins — via `section.top_margin` etc. in python-docx

**Layer 3 — Profile defaults** (`PROFILE_DEFAULTS`): Hardcoded per profile:
- `academic`: SimSun body 12pt, SimHei headings 16/14/12pt, 1.5x, margins 25.4mm
- `thesis`: SimSun body 12pt, SimHei headings 22/16/14pt (GB/T 7713), 1.5x, margins 30mm
- `business`: Arial body 11pt, Arial headings 18/14/12pt, 1.5x, margins 25.4mm
- `technical`: Arial body 11pt, Arial headings 16/14/12pt, 1.35x, Consolas code, margins 19mm
- `official`: FangSong body 16pt, SimHei/KaiTi/FangSong headings 16pt, 1.75x, margins 37/35/28/26mm (GB/T 9704)
- `template`: no defaults (rely on reference.docx entirely)

### Key design decisions

- **pypandoc-binary**: pandoc binary bundled in the pip package, installed at plugin init — no runtime download, no network dependency for conversion
- **_warmup_pandoc()**: pre-loads pandoc on plugin startup (when `LOAD_FROM_DIFY_PLUGIN=1`) for fast first invocation
- **Mermaid Ink API**: Free public HTTP service for Mermaid rendering. No auth, no rate limiting. Users can disable via `mermaid_enabled: false`
- **python-docx + lxml**: Style overrides use python-docx for high-level access + lxml for raw XML manipulation when needed (fonts, spacing, shading, colors)
- **User overrides > Profile defaults**: Every style parameter can be overridden individually; `0` or empty means "use profile default"
- **Script style**: Avoiding `from __future__ import annotations` to maintain compatibility
- **Safety guards**: `markdown_content` is capped at 5 MB (`MAX_MARKDOWN_BYTES`) to prevent OOM in the Dify plugin sandbox
- **Mermaid resilience**: 3 attempts per diagram (1s/2s backoff), 120s total budget, and a per-attempt 30s timeout
- **Pandoc output cleanup**: `_strip_dangling_image_rels` removes image/oleObject relationships inherited from reference templates whose target files are missing, so python-docx can always open the produced DOCX
- **custom_template safety**: A `str` value for `custom_template` is rejected with a clear warning instead of being written as a corrupted binary

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

