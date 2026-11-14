# md2docx — Markdown to DOCX for Dify

[![Dify](https://img.shields.io/badge/Dify-Plugin-1c64f2?logo=dify)](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=alexmultiagent.mdocx-converter)

Convert Markdown to polished Word documents inside Dify workflows. Built-in Chinese/English templates, Mermaid diagram rendering, and fine-grained style control. No API key required.

[Documentation in Chinese](https://github.com/AlexMultiAgent/mdocx-converter/blob/main/dify-plugin-MD2Docx/readme/README_zh_Hans.md) | [Marketplace](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx)

## Tools

| Tool                            | Params | Use case                                    |
| ------------------------------- | ------ | ------------------------------------------- |
| **Markdown to DOCX**            | 6      | Everyday conversion — pick a profile and go |
| **Markdown to DOCX (Advanced)** | 19     | Full control over fonts, sizes, margins     |
| **Mermaid to Image**            | 2      | Render a standalone Mermaid diagram to PNG  |

## Installation

### From the Dify Marketplace

1. In your Dify workspace, open **Plugins → Marketplace**.
2. Search for **md2docx**.
3. Click **Install**.

### From a local `.difypkg`

```bash
python scripts/package.py --output MD2Docx.difypkg
# Then in Dify: Plugins → Local → Upload → select the .difypkg
```

The package depends on `pypandoc-binary`, which bundles Pandoc inside the pip wheel. No GitHub download at runtime.

## Features

- **6 style profiles** backed by 10 built-in reference DOCX templates (Chinese + English): `technical`, `business`, `official` (GB/T 9704), `academic`, `thesis` (GB/T 7713), and `template`. Every profile except `template` has its own pair; `template` reuses the academic one.
- **Mermaid rendering** via Mermaid Ink API. Inline in DOCX or standalone via the `Mermaid to Image` tool.
- **Fine-grained overrides**: 13 advanced parameters for body/heading fonts, sizes, line spacing, and margins.
- **Bilingual typography**: Latin and East Asian font slots are configured separately, using Times New Roman / Arial for Latin text and SimSun / SimHei / FangSong / KaiTi / Microsoft YaHei for CJK text.
- **Self-contained**: `pypandoc-binary` bundles Pandoc; no runtime download.

## Style Profiles

| Profile     | Body Font (Latin / CJK) | Body Size | Headings (Latin / CJK)                    | Line Spacing | Margins (mm) | Standard                |
| ----------- | ----------------------- | --------- | ----------------------------------------- | ------------ | ------------ | ----------------------- |
| `technical` | Arial / Microsoft YaHei | 11 pt     | Arial / Microsoft YaHei 16 / 14 / 12 pt   | 1.35         | 19           | Tech blogs, API docs    |
| `business`  | Arial / Microsoft YaHei | 11 pt     | Arial / Microsoft YaHei 18 / 14 / 12 pt   | 1.5          | 25.4         | Business reports, memos |
| `official`  | Times New Roman / FangSong | 16 pt  | Times / SimHei, KaiTi, FangSong 16 pt     | fixed 29 pt  | 37/35/28/26  | GB/T 9704               |
| `academic`  | Times New Roman / SimSun | 12 pt    | Times New Roman / SimHei 16 / 14 / 12 pt  | 1.5          | 25.4/25.4/31.75/31.75 | Academic writing, CSSCI |
| `thesis`    | Times New Roman / SimSun | 12 pt    | Times New Roman / SimHei 22 / 16 / 14 pt  | 1.5          | 30           | GB/T 7713               |
| `template`  | (from reference)        | —         | —                                         | —            | —            | Fully custom            |

> English `official` and `thesis` templates exist as compatibility companions; no specific English standard.

## Parameters

### Markdown to DOCX (6)

| #   | Parameter            | Type    | Required | Default      | Description                                                |
| --- | -------------------- | ------- | -------- | ------------ | ---------------------------------------------------------- |
| 1   | `markdown_content`   | string  | yes      | —            | The Markdown text (max 5 MB; GFM, tables, `data:` images, Mermaid) |
| 2   | `title`              | string  | no       | `"Document"` | Output filename without `.docx`                            |
| 3   | `style_profile`      | select  | no       | `academic`   | Style preset (see table above)                             |
| 4   | `reference_language` | select  | no       | `auto`       | `auto` / `english` / `chinese`                             |
| 5   | `mermaid_enabled`    | boolean | no       | `true`       | Render Mermaid blocks to images                            |
| 6   | `mermaid_api_url`    | string  | no       | —            | Self-hosted Mermaid Ink URL                                |

### Markdown to DOCX (Advanced)

All 6 core parameters above plus 13 style overrides: `body_font`, `body_size_pt`, `line_spacing`, `margin_top_mm`, `margin_bottom_mm`, `margin_left_mm`, `margin_right_mm`, `heading1_font`, `heading1_size_pt`, `heading2_font`, `heading2_size_pt`, `heading3_font`, `heading3_size_pt`. All default to profile preset or `0` (= use default).

Font sizes are accepted from 1 to 96 pt, line spacing from 0.5 to 4.0, and margins from 1 to 50 mm. Invalid values fall back to the selected profile.

### Mermaid to Image (2)

| #   | Parameter         | Type   | Required | Default | Description                 |
| --- | ----------------- | ------ | -------- | ------- | --------------------------- |
| 1   | `mermaid_code`    | string | yes      | —       | Mermaid diagram syntax      |
| 2   | `mermaid_api_url` | string | no       | —       | Self-hosted Mermaid Ink URL |

## Self-hosted Mermaid

Deploy your own Mermaid Ink instance if the public service is slow or unreachable:

```bash
docker run -d --restart unless-stopped -p 3000:3000 ghcr.io/jihchi/mermaid.ink
```

With `docker compose`:

```yaml
mermaid_ink:
  image: ghcr.io/jihchi/mermaid.ink
  restart: unless-stopped
  ports:
    - "3000:3000"
```

Then set `mermaid_api_url` to `http://<host>:3000` (use `http://mermaid_ink:3000` inside compose). Provide the final endpoint directly; HTTP redirects are not followed.

## Network & Privacy

- **Mermaid Ink** (`https://mermaid.ink`): Mermaid source code is sent for PNG rendering. No other data is transmitted. Disable via `mermaid_enabled=false` or use a self-hosted instance.
- **Pandoc**: bundled in `pypandoc-binary`. It runs with `--sandbox`, so Markdown cannot read local files or trigger outbound image requests. Embed supplied images as `data:` URIs.
- **Temp files**: cleaned up after each conversion. On Windows, paths may contain the OS username.

Full policy: [PRIVACY.md](./PRIVACY.md).

## Development

```bash
pip install -r requirements.txt
pip install -r requirements-dev.txt
pytest tests/ -v
python scripts/package.py --output MD2Docx.difypkg
```

Run `RUN_LIVE_MERMAID=1 pytest tests/test_mermaid_live.py -v` to verify the public Mermaid Ink endpoint; normal tests never depend on external networking.

Repository: [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter)
