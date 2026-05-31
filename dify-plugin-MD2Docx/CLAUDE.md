# CLAUDE.md

This plugin lives in the `dify-plugin-MD2Docx/` directory of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo. The sibling `VSC-plugin-MD2Docx-Converter/` directory contains the original VS Code extension this plugin is ported from.

## Commands

```bash
pip install -r requirements.txt                                # install dependencies
python -c "import ast; ast.parse(open('src/md2docx.py').read()); print('Syntax OK')"  # syntax check
python tests/smoke_test.py                                     # run smoke test (needs pandoc)
```

There is no formal test suite — only `tests/smoke_test.py`.

## Architecture

This is a **Dify Tool plugin** that converts Markdown to DOCX. The plugin consists of YAML schemas + a single Python file: `src/md2docx.py` (~555 lines).

### Conversion pipeline

```
markdown_content
  │
  ├─ 1. Language detection: sample first 20K chars → count CJK vs Latin → auto/en/zh
  │
  ├─ 2. Template resolution:
  │     custom_template (uploaded file) > built-in 6 ref.docx (profile × language)
  │
  ├─ 3. Mermaid preprocessing (if enabled):
  │     regex ```mermaid blocks → Mermaid Ink API → PNG bytes → temp file
  │     Replace blocks with ![diagram](temp.png) in markdown
  │     Falls back to preserving original code block if API fails
  │
  ├─ 4. Pandoc conversion:
  │     pypandoc.convert_text() with --reference-doc and --metadata
  │     pypandoc.download_pandoc() auto-downloads pandoc binary on first use (~50MB)
  │
  ├─ 5. DOCX style overrides:
  │     python-docx opens generated .docx
  │     Modify Normal, Heading1-3 styles (font, size, line spacing) via lxml
  │     Technical profile: SourceCode + VerbatimChar (Consolas 10pt, color #1F2937)
  │     Page margins via section properties
  │
  └─ 6. Return: text_message + blob_message(docx_bytes)
```

### File structure

```
dify-plugin-MD2Docx/
├── manifest.yaml              # Plugin metadata, runtime config
├── requirements.txt           # pypandoc, python-docx, requests, lxml
├── PRIVACY.md                 # Mermaid Ink API & Pandoc download disclosure
├── icon.svg
├── multi-templates/           # 6 reference.docx (copied from VSC plugin)
├── provider/
│   └── md2docx.yaml           # Tool Provider declaration
├── tools/
│   └── md_to_docx.yaml        # Tool parameter schema (19 parameters)
└── src/
    ├── __init__.py
    └── md2docx.py              # Core conversion — all logic in one file
```

### Tool parameters (19 total)

**Core (5):** `markdown_content` (req, llm), `title` (opt, llm), `style_profile` (select, form), `reference_language` (select, form), `custom_template` (file, form)

**Extended (1):** `mermaid_enabled` (boolean, form, default: true)

**Advanced (13):** `body_font`, `body_size_pt`, `line_spacing`, `margin_top_mm`, `margin_bottom_mm`, `margin_left_mm`, `margin_right_mm`, `heading1_font`, `heading1_size_pt`, `heading2_font`, `heading2_size_pt`, `heading3_font`, `heading3_size_pt`

### Template resolution

1. Custom uploaded `.docx` (if provided via `custom_template` parameter)
2. Built-in template from `multi-templates/` selected by `style_profile` × `reference_language`

Bundled template mapping lives in `TEMPLATE_MAP` constant. Academic and `template` profiles share the same academic reference files. Technical and business each have their own English/Chinese pair.

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
- `academic`: SimSun body 12pt, SimHei headings, 1.5 line spacing
- `business`: Arial body 11pt, Arial headings, 1.3 line spacing
- `technical`: Arial body 11pt, Arial headings, 1.25 line spacing, Consolas code
- `template`: no defaults (rely on reference.docx entirely)

### Key design decisions

- **pypandoc + auto-download**: `pypandoc.download_pandoc()` downloads pandoc at runtime (~50MB), does NOT count toward the plugin package size limit
- **Mermaid Ink API**: Free public HTTP service for Mermaid rendering. No auth, no rate limiting. Users can disable via `mermaid_enabled: false`
- **python-docx + lxml**: Style overrides use python-docx for high-level access + lxml for raw XML manipulation when needed (fonts, spacing, shading, colors)
- **User overrides > Profile defaults**: Every style parameter can be overridden individually; `0` or empty means "use profile default"
- **Script style**: Avoiding `from __future__ import annotations` to maintain compatibility

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
