# md2docx — Markdown to DOCX for Dify

[![Dify](https://img.shields.io/badge/Dify-Plugin-1c64f2?logo=dify)](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=alexmultiagent.mdocx-converter)

Convert Markdown to polished Microsoft Word documents in Dify workflows. Built-in Chinese/English templates, Mermaid diagram rendering, and fine-grained style control.

## Installation

### From Dify Marketplace

1. Open your Dify workspace → **Plugins** → **Marketplace**
2. Search for "md2docx"
3. Click **Install**

### From local `.difypkg`

```bash
# Build the plugin package
pip install dify-plugin-cli
dify-plugin package .

# Install the generated .difypkg in Dify
# Plugins → Local → Upload
```

## Style Profiles

| Profile | Body Font | Body Size | Headings | Line Spacing | Margins (mm) | 适用标准 |
|---------|-----------|-----------|----------|-------------|-------------|---------|
| **academic** | SimSun | 12pt | SimHei 16/14/12pt | 1.5 | 25.4 | CSSCI 期刊通用 |
| **thesis** | SimSun | 12pt | SimHei 22/16/14pt | 1.5 | 30 | GB/T 7713 学位论文 |
| **technical** | Arial | 11pt | Arial 16/14/12pt | 1.35 | 19 | 技术博客 / API 文档 |
| **business** | Arial | 11pt | Arial 18/14/12pt | 1.5 | 25.4 | 商务报告 / 内部备忘录 |
| **government** | FangSong | 16pt | SimHei (H1) / KaiTi (H2) / FangSong (H3) 16pt | 1.75 | 37/35/28/26 | GB/T 9704-2012 |
| **template** | (from reference docx) | — | — | — | — | 完全自定义 |

All profile defaults can be overridden per invocation via the Advanced parameters.

### 如何选择 style profile？

- **投稿到 IEEE/ACM/Springer** → 暂不支持直接投稿，请使用官方模板上传为 `custom_template`
- **国内学位论文（GB/T 7713）** → `thesis` profile（H1 二号 22pt、四周 30mm）
- **国内 CSSCI 期刊投稿** → `academic` profile 默认值即可
- **政府公文（GB/T 9704）** → `government` profile
- **现代商务文档 / PPT 风格报告** → `business` profile
- **技术博客 / 现代 API 文档** → `technical` profile
- **完全自定义** → `template` profile + 上传 `custom_template`

## Parameter Reference (19 total)

### Core Parameters

| # | Parameter | Type | Required | Default | Description |
|---|-----------|------|----------|---------|-------------|
| 1 | `markdown_content` | string | ✅ | — | Markdown text to convert (GFM, tables, images, Mermaid) |
| 2 | `title` | string | — | `"Document"` | Output filename (without `.docx`) |
| 3 | `style_profile` | select | — | `"academic"` | One of: `academic`, `thesis`, `technical`, `business`, `government`, `template` |
| 4 | `reference_language` | select | — | `"auto"` | Template language: `auto`, `english`, `chinese` |
| 5 | `custom_template` | file | — | — | Upload a custom `reference.docx` to override built-in template |

### Extended Parameters

| # | Parameter | Type | Required | Default | Description |
|---|-----------|------|----------|---------|-------------|
| 6 | `mermaid_enabled` | boolean | — | `true` | Render ` ```mermaid` blocks via Mermaid Ink API |

### Advanced Parameters (Style Overrides)

| # | Parameter | Type | Required | Default | Description |
|---|-----------|------|----------|---------|-------------|
| 7 | `body_font` | string | — | profile default | Body text font name |
| 8 | `body_size_pt` | number | — | profile default | Body font size (pt). Set 0 for default |
| 9 | `line_spacing` | number | — | profile default | Line spacing multiplier (1.0, 1.5, 2.0, etc.) |
| 10 | `margin_top_mm` | number | — | profile default | Top page margin in mm |
| 11 | `margin_bottom_mm` | number | — | profile default | Bottom page margin in mm |
| 12 | `margin_left_mm` | number | — | profile default | Left page margin in mm |
| 13 | `margin_right_mm` | number | — | profile default | Right page margin in mm |
| 14 | `heading1_font` | string | — | profile default | Heading 1 font name |
| 15 | `heading1_size_pt` | number | — | profile default | Heading 1 font size (pt) |
| 16 | `heading2_font` | string | — | profile default | Heading 2 font name |
| 17 | `heading2_size_pt` | number | — | profile default | Heading 2 font size (pt) |
| 18 | `heading3_font` | string | — | profile default | Heading 3 font name |
| 19 | `heading3_size_pt` | number | — | profile default | Heading 3 font size (pt) |

## Network Requirements

On first invocation, `pypandoc` automatically downloads the **Pandoc** binary from GitHub Releases:

| Detail | Value |
|--------|-------|
| Download size | ~50 MB (compressed) |
| Extracted size | ~150 MB |
| Download URL | `https://github.com/jgm/pandoc/releases` |
| Frequency | Once, cached for subsequent calls |

**⚠️ Restricted environments:** In air-gapped, firewalled, or proxy-restricted deployments, this download may fail. Mitigations:

- **Pre-install pandoc** on the Dify runner (`apt install pandoc` / `brew install pandoc`)
- **Ensure outbound access** to `github.com` and `github-releases.githubusercontent.com`
- **Test first run** in a non-production environment to verify connectivity

Once downloaded, pandoc is cached and no further network access is needed for pandoc itself.

## Dify `.env` Configuration

For self-hosted Dify deployments, configure the pip mirror source in `docker/.env` to match your region. This plugin's Python dependencies (~5 packages) are installed at plugin init time and benefit from a nearby mirror.

### `PIP_MIRROR_URL`

```ini
# 🇨🇳 China — 阿里云镜像（推荐）
PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple/

# 🌍 All other locations — 保持默认（留空或不设置，pip 自动走 PyPI 官方源）
# PIP_MIRROR_URL=
```

**Select according to your region:**
- **China** → `PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple/`
- **All other locations** → leave empty / not set (pip uses `https://pypi.org/simple/` by default)

### Related sandbox settings

```ini
# Increase timeouts if installing over slow connections
PLUGIN_PYTHON_ENV_INIT_TIMEOUT=720       # Python env init timeout (seconds, default: 120)
PLUGIN_MAX_EXECUTION_TIMEOUT=1800        # Max plugin execution timeout (seconds, default: 600)

# Trust custom mirrors if using HTTP (HTTPS mirrors don't need this)
PIP_TRUSTED_HOST=mirrors.aliyun.com
```

After changing `.env`, restart Dify:
```bash
docker compose down && docker compose up -d
```

Verify the setting took effect:
```bash
docker exec -it docker-plugin_daemon-1 env | grep PIP_MIRROR_URL
docker exec -it docker-sandbox-1 env | grep PIP_MIRROR_URL
```

## Privacy

This plugin may make external network requests:

- **Mermaid Ink API** (`mermaid.ink`): When `mermaid_enabled` is `true`, Mermaid code blocks are sent to this public service for rendering. Set `mermaid_enabled: false` to disable.
- **Pandoc Download**: See [Network Requirements](#network-requirements) above.

See [PRIVACY.md](./PRIVACY.md) for full details.

## Development

```bash
pip install -r requirements.txt
python -c "import ast; ast.parse(open('src/md2docx.py').read()); print('Syntax OK')"
python tests/smoke_test.py
```

Part of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo.
