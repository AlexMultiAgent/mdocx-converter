# md2docx — Markdown 转 Word（Dify 插件）

[![Dify](https://img.shields.io/badge/Dify-Plugin-1c64f2?logo=dify)](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=alexmultiagent.mdocx-converter)

在 Dify 工作流中将 Markdown 转为精美的 Word 文档。内置中英文模板、Mermaid 图表渲染、字体/行距/边距精细控制。无需 API 密钥。

[English docs](../README.md) | [Marketplace](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx)

## 工具列表

| 工具 | 参数数 | 用途 |
|------|--------|------|
| **Markdown to DOCX** | 6 | 日常转换——选样式预设即可 |
| **Markdown to DOCX (Advanced)** | 19 | 完整控制字体、字号、边距 |
| **Mermaid to Image** | 2 | 独立渲染 Mermaid 图表为 PNG |

## 安装

### 从 Dify Marketplace

1. 进入 Dify 工作区 → **插件** → **Marketplace**
2. 搜索 **md2docx**
3. 点击 **安装**

### 从本地 `.difypkg`

```bash
pip install dify-plugin-cli
dify-plugin plugin package .
# 在 Dify: 插件 → 本地 → 上传 → 选择生成的 .difypkg
```

依赖 `pypandoc-binary`，pip 安装时自带 Pandoc 二进制，运行时无需从 GitHub 下载。

## 功能

- **6 种样式预设**，内置中英文参考模板（2 语言 × 6 样式）：`technical`（技术文档）、`business`（商业报告）、`official`（GB/T 9704-2012 公文）、`academic`（学术论文）、`thesis`（GB/T 7713 学位论文）、`template`（完全自定义）。
- **Mermaid 渲染**：通过 Mermaid Ink API 将代码块转为 PNG。可在 DOCX 内嵌，也可通过独立 `Mermaid to Image` 工具单独渲染。
- **13 项样式覆盖**：正文/标题字体、字号、行距、四边距均可逐项覆盖。
- **中文优先**：自动中英文检测，SimSun / SimHei / FangSong / KaiTi 全覆盖。
- **离线可用**：`pypandoc-binary` 内置 Pandoc，首次调用无网络依赖。

## 样式预设

| 样式 | 正文字体 | 字号 | 标题字体 | 行距 | 边距 (mm) | 适用标准 |
|------|---------|------|---------|------|-----------|---------|
| `technical` | Arial | 11 pt | Arial 16/14/12 pt | 1.35 | 19 | 技术博客 / API 文档 |
| `business` | Arial | 11 pt | Arial 18/14/12 pt | 1.5 | 25.4 | 商务报告 / 内部备忘录 |
| `official` | FangSong | 16 pt | SimHei/KaiTi/FangSong 16 pt | 1.75 | 37/35/28/26 | GB/T 9704-2012 |
| `academic` | SimSun | 12 pt | SimHei 16/14/12 pt | 1.5 | 25.4 | CSSCI 期刊 / 学术写作 |
| `thesis` | SimSun | 12 pt | SimHei 22/16/14 pt | 1.5 | 30 | GB/T 7713 |
| `template` | 参考文件决定 | — | — | — | — | 完全自定义 |

> `official` 和 `thesis` 的英文模板仅作兼容性配套，无特定英文标准依据。

## 如何选择样式

- **国内学位论文 (GB/T 7713)** → `thesis`
- **CSSCI 期刊投稿** → `academic`
- **政府公文 (GB/T 9704)** → `official`
- **商务报告 / PPT 风格** → `business`
- **技术博客 / API 文档** → `technical`
- **IEEE/ACM/Springer 投稿** → 下载官方模板，用 `template` 样式
- **完全自定义** → `template`

## 参数说明

### Markdown to DOCX（6 项）

| # | 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|------|------|------|--------|------|
| 1 | `markdown_content` | string | 是 | — | Markdown 文本（最大 5MB） |
| 2 | `title` | string | 否 | `"Document"` | 输出文件名（不含 `.docx`） |
| 3 | `style_profile` | select | 否 | `academic` | 样式预设 |
| 4 | `reference_language` | select | 否 | `auto` | 模板语言：自动/英文/中文 |
| 5 | `mermaid_enabled` | boolean | 否 | `true` | 是否渲染 Mermaid 代码块 |
| 6 | `mermaid_api_url` | string | 否 | — | 自部署 Mermaid Ink 地址 |

### Markdown to DOCX (Advanced)（19 项）

包含上述 6 项全部参数，加上 13 项样式覆盖：`body_font`、`body_size_pt`、`line_spacing`、`margin_top_mm`、`margin_bottom_mm`、`margin_left_mm`、`margin_right_mm`、`heading1_font`、`heading1_size_pt`、`heading2_font`、`heading2_size_pt`、`heading3_font`、`heading3_size_pt`。全部默认为样式预设值（`0` = 使用默认值）。

### Mermaid to Image（2 项）

| # | 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|------|------|------|--------|------|
| 1 | `mermaid_code` | string | 是 | — | Mermaid 图表语法 |
| 2 | `mermaid_api_url` | string | 否 | — | 自部署 Mermaid Ink 地址 |

## 自部署 Mermaid

如果公共服务 `mermaid.ink` 访问慢或不可达，部署自己的实例：

```bash
docker run -d --restart unless-stopped -p 3000:3000 ghcr.io/jihchi/mermaid.ink
```

使用 `docker compose` 部署 Dify 时，在 `docker-compose.yaml` 中添加：

```yaml
mermaid_ink:
  image: ghcr.io/jihchi/mermaid.ink
  restart: unless-stopped
  ports:
    - "3000:3000"
```

然后在工具参数中设置 `mermaid_api_url` 为 `http://<服务器地址>:3000`（compose 内部用 `http://mermaid_ink:3000`）。

如使用 Dify 的 `.env` 配置：

```ini
MERMAID_INK_URL=http://your-server:3000
```

## 网络与隐私

- **Mermaid Ink**：Mermaid 源码文本会发送至渲染服务。不传输其他文档内容。可通过 `mermaid_enabled=false` 关闭或使用自部署实例。
- **Pandoc**：随 `pypandoc-binary` 内置，无网络访问。
- **临时文件**：每次转换后自动清理。

完整说明：[../PRIVACY.md](../PRIVACY.md)

## 部署调优

### pip 镜像源

自部署 Dify 时，在 `docker/.env` 中设置：

```ini
# 中国大陆 — 阿里云镜像
PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple/

# 其他地区 — 留空，pip 默认走 PyPI 官方源
```

### 沙盒超时

```ini
PLUGIN_PYTHON_ENV_INIT_TIMEOUT=720
PLUGIN_MAX_EXECUTION_TIMEOUT=1800
```

修改后重启：`docker compose down && docker compose up -d`

## 开发

```bash
pip install -r requirements.txt
pip install -r requirements-dev.txt
pytest tests/ -v
```

仓库：[mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter)
