# md2docx — Markdown to DOCX for Dify

[![Dify](https://img.shields.io/badge/Dify-Plugin-1c64f2?logo=dify)](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=alexmultiagent.mdocx-converter)

Convert Markdown to polished Microsoft Word documents inside Dify workflows. Built-in Chinese/English templates, Mermaid diagram rendering, and fine-grained font/spacing/margin control. No external API key required.

[Chinese documentation](./readme/README_zh_Hans.md) | Marketplace listing: https://marketplace.dify.ai/plugin/alexmultiagent/md2docx

## Installation

### From the Dify Marketplace

1. In your Dify workspace, open **Plugins** → **Marketplace**.
2. Search for **md2docx**.
3. Click **Install**.

### From a local `.difypkg`

```bash
# In a clean Python environment
pip install dify-plugin-cli
dify-plugin plugin package .
# Then in Dify: Plugins → Local → Upload → select the .difypkg
```

The package depends on `pypandoc-binary`, which bundles the Pandoc binary inside the pip wheel. The first invocation needs no GitHub download.

## Features

- **6 style profiles** mapped to 12 built-in reference DOCX templates (2 languages × 6 profiles), including presets for `academic`, `thesis` (GB/T 7713), `technical`, `business`, `official` (GB/T 9704-2012), and `template` (use your own reference only).
- **Mermaid rendering** via the public Mermaid Ink API — `` ```mermaid `` blocks are converted to PNG and embedded in the output. Disable with `mermaid_enabled=false` for offline or privacy-sensitive content.
- **Fine-grained style overrides**: 13 advanced parameters let you override body/heading fonts, sizes, line spacing, and four margins per call.
- **CJK-first**: automatic Chinese/English detection, full SimSun / SimHei / FangSong / KaiTi / Microsoft YaHei defaults.
- **DOCX post-processing**: dangling image relationships from reference templates are stripped so every output opens cleanly in Word and python-docx.

## Style Profiles

| Profile     | Body Font             | Body Size | Headings                                       | Line Spacing | Margins (mm)      | Standard / Use case                              |
| ----------- | --------------------- | --------- | ---------------------------------------------- | ------------ | ----------------- | ------------------------------------------------ |
| `academic`  | SimSun                | 12 pt     | SimHei 16 / 14 / 12 pt                         | 1.5          | 25.4              | Academic writing, CSSCI submissions              |
| `thesis`    | SimSun                | 12 pt     | SimHei 22 / 16 / 14 pt                         | 1.5          | 30                | Degree thesis (GB/T 7713)                        |
| `technical` | Arial                 | 11 pt     | Arial 16 / 14 / 12 pt                          | 1.35         | 19                | Tech blogs, API docs                             |
| `business`  | Arial                 | 11 pt     | Arial 18 / 14 / 12 pt                          | 1.5          | 25.4              | Business reports, internal memos                 |
| `official`  | FangSong              | 16 pt     | SimHei (H1) / KaiTi (H2) / FangSong (H3) 16 pt | 1.75         | 37 / 35 / 28 / 26 | Government / official documents (GB/T 9704-2012) |
| `template`  | (from reference DOCX) | —         | —                                              | —            | —                 | Pure template, no preset overrides               |

All profile defaults can be overridden per call via the advanced parameters.

## Parameters (18 total)

### Core

| #   | Parameter            | Type   | Required | Default      | Description                                                                        |
| --- | -------------------- | ------ | -------- | ------------ | ---------------------------------------------------------------------------------- |
| 1   | `markdown_content`   | string | yes      | —            | The Markdown text to convert (max 5 MB; GFM, tables, images, Mermaid)              |
| 2   | `title`              | string | no       | `"Document"` | Output filename without `.docx`                                                    |
| 3   | `style_profile`      | select | no       | `academic`   | One of: `academic`, `thesis`, `technical`, `business`, `official`, `template`      |
| 4   | `reference_language` | select | no       | `auto`       | Template language: `auto`, `english`, `chinese` (samples the first 20K characters) |

### Extended

| #   | Parameter         | Type    | Required | Default | Description                                            |
| --- | ----------------- | ------- | -------- | ------- | ------------------------------------------------------ |
| 5   | `mermaid_enabled` | boolean | no       | `true`  | Render `` ```mermaid `` blocks via the Mermaid Ink API |

### Advanced (style overrides)

| #   | Parameter          | Type   | Required | Default             | Description                                                  |
| --- | ------------------ | ------ | -------- | ------------------- | ------------------------------------------------------------ |
| 6   | `body_font`        | string | no       | profile default     | Body text font name                                          |
| 7   | `body_size_pt`     | number | no       | 0 (profile default) | Body font size in points. `0` = default                      |
| 8   | `line_spacing`     | number | no       | 0                   | Line spacing multiplier (1.0, 1.25, 1.5, 2.0). `0` = default |
| 9   | `margin_top_mm`    | number | no       | 0                   | Top page margin in mm. `0` = default                         |
| 10  | `margin_bottom_mm` | number | no       | 0                   | Bottom page margin in mm. `0` = default                      |
| 11  | `margin_left_mm`   | number | no       | 0                   | Left page margin in mm. `0` = default                        |
| 12  | `margin_right_mm`  | number | no       | 0                   | Right page margin in mm. `0` = default                       |
| 13  | `heading1_font`    | string | no       | profile default     | Heading 1 font name                                          |
| 14  | `heading1_size_pt` | number | no       | 0                   | Heading 1 font size in points. `0` = default                 |
| 15  | `heading2_font`    | string | no       | profile default     | Heading 2 font name                                          |
| 16  | `heading2_size_pt` | number | no       | 0                   | Heading 2 font size in points. `0` = default                 |
| 17  | `heading3_font`    | string | no       | profile default     | Heading 3 font name                                          |
| 18  | `heading3_size_pt` | number | no       | 0                   | Heading 3 font size in points. `0` = default                 |

## Network and privacy

- **Mermaid Ink** (`https://mermaid.ink/img`): when `mermaid_enabled=true`, each `` ```mermaid `` code block is sent to this public service for rendering. The block source code is the only payload. Set `mermaid_enabled=false` to disable.
- **Pandoc**: bundled inside the `pypandoc-binary` pip wheel, so no GitHub download is needed at first run. No user data is transmitted.
- **Temporary files**: Mermaid PNGs and any uploaded template are written to the plugin sandbox temp dir and cleaned up after each conversion. On Windows the path may contain the OS username.

Full privacy policy: [PRIVACY.md](./PRIVACY.md).

## Development

```bash
pip install -r requirements.txt
pip install -r requirements-dev.txt
pytest tests/ -v
```

Repository: https://github.com/AlexMultiAgent/mdocx-converter (part of the mdocx-converter monorepo).


