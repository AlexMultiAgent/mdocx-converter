# md2docx — Markdown 转 Word（Dify 插件）

[![Dify](https://img.shields.io/badge/Dify-Plugin-1c64f2?logo=dify)](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx)
[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-007ACC?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=alexmultiagent.mdocx-converter)

在 Dify 工作流中将 Markdown 转为精美的 Word 文档。内置中英文模板、Mermaid 图表渲染、字体/行距/边距精细控制。无需任何外部 API 密钥。

> Marketplace 列表：https://marketplace.dify.ai/plugin/alexmultiagent/md2docx
> 英文文档：[../README.md](../README.md)

## 安装

### 从 Dify Marketplace

1. 进入 Dify 工作区，打开 **Plugins** → **Marketplace**
2. 搜索 **md2docx**
3. 点击 **Install**

### 从本地 `.difypkg`

```bash
# 在独立 Python 环境中
pip install dify-plugin-cli
dify-plugin plugin package .
# 然后在 Dify: Plugins → Local → Upload → 选择生成的 .difypkg
```

该包依赖 `pypandoc-binary`，其 pip 轮子内部已带 Pandoc 二进制，首次调用无需从 GitHub 下载。

## 功能

- **6 种样式预设**，对应 12 个内置参考模板（中英文 × 6 种样式），包括 `academic`、`thesis`（GB/T 7713 学位论文）、`technical`、`business`、`official`（GB/T 9704-2012 公文）以及 `template`（仅使用你自己的参考文件）。
- **Mermaid 渲染**：通过公共 Mermaid Ink API 将 `` ```mermaid `` 代码块转为 PNG 嵌入输出。需要离线或注重隐私时，设 `mermaid_enabled=false` 即可禁用。
- **13 项样式覆盖参数**：每次调用可对正文/标题字体、字号、行距、四个边距进行单独覆盖。
- **中文优先**：自动检测中文/英文，默认完整覆盖 SimSun / SimHei / FangSong / KaiTi / Microsoft YaHei 。
- **DOCX 后处理**：自动剖除参考模板遗留的孤立图片关系，保证输出文件能被 Word 和 python-docx 正常打开。

## 样式预设详情

| Profile        | 正文字体 | 正文字号 | 标题字体                | 行距    | 边距 (mm)         | 适用标准 / 场景                          |
|----------------|------------------|------------------|----------------------------------|-------------|----------------------|--------------------------------------------------|
| `academic`     | SimSun           | 12 pt            | SimHei 16/14/12 pt               | 1.5         | 25.4                 | 学术写作 / CSSCI 期刊投稿（学位论文请用 `thesis`） |
| `thesis`       | SimSun           | 12 pt            | SimHei 22/16/14 pt               | 1.5         | 30                   | GB/T 7713 学位论文                |
| `technical`    | Arial            | 11 pt            | Arial 16/14/12 pt                | 1.35        | 19                   | 技术博客 / API 文档                            |
| `business`     | Arial            | 11 pt            | Arial 18/14/12 pt                | 1.5         | 25.4                 | 商务报告 / 内部备忘录                        |
| `official`     | FangSong         | 16 pt            | SimHei (H1) / KaiTi (H2) / FangSong (H3) 16 pt | 1.75 | 37 / 35 / 28 / 26 | GB/T 9704-2012 公文                          |
| `template`     | 参考文件决定          | —              | —                              | —         | —                  | 完全自定义，不应用任何预设覆盖          |

所有预设均可在调用时通过高级参数进行单独覆盖。

> **关于模板**：`official`（中文）和 `thesis`（中文）分别对应 GB/T 9704-2012 和 GB/T 7713，各有独立中文模板文件。对应的英文模板仅作为兼容性配套存在，无特定英文公文/学位论文标准依据。

## 如何选择 style profile？

- **投稿到 IEEE / ACM / Springer** → 请下载官方 `.dotx` 模板，手动改为自定义参考样式。
- **国内学位论文（GB/T 7713）** → `thesis` profile（H1 二号 22pt、四周 30mm）
- **国内 CSSCI 期刊投稿** → `academic` profile 默认值即可
- **政府公文（GB/T 9704）** → `official` profile
- **现代商务文档 / PPT 风格报告** → `business` profile
- **技术博客 / 现代 API 文档** → `technical` profile
- **完全自定义** → `template` profile 仅使用参考模板自身

## 参数说明（18 项）

### 核心参数

| #  | 参数                 | 类型   | 必填 | 默认值          | 说明                                                                |
|----|----------------------------|--------------|----------|----------------------|--------------------------------------------------------------------------|
| 1  | `markdown_content`         | string       | ✅       | —                    | 要转换的 Markdown 文本（最大 5MB；支持 GFM、表格、图片、Mermaid） |
| 2  | `title`                    | string       | —        | `"Document"`         | 输出文件名（不含 `.docx`）                  |
| 3  | `style_profile`            | select       | —        | `academic`           | 可选：`academic`, `thesis`, `technical`, `business`, `official`, `template` |
| 4  | `reference_language`       | select       | —        | `auto`               | 模板语言：`auto`、`english`、`chinese`（自动检测采样前 20K 字符） |

### 扩展参数

| #  | 参数           | 类型  | 必填 | 默认值 | 说明                                            |
|----|---------------------|-------------|----------|---------|--------------------------------------------------|
| 5  | `mermaid_enabled`   | boolean     | —        | `true`  | 是否通过 Mermaid Ink API 渲染 `` ```mermaid `` 代码块 |

### 高级参数（样式覆盖）

| #  | 参数                 | 类型   | 必填 | 默认值                | 说明                          |
|----|--------------------------|--------------|----------|----------------------------|---------------------------------|
| 6  | `body_font`              | string       | —        | 预设默认值          | 正文字体名称             |
| 7  | `body_size_pt`           | number       | —        | 0（预设默认值）     | 正文字号（点），设 0 使用默认值 |
| 8  | `line_spacing`           | number       | —        | 0                            | 行距倍数（如 1.0、1.25、1.5、2.0），设 0 使用默认值 |
| 9  | `margin_top_mm`          | number       | —        | 0                            | 上边距（毫米），设 0 使用默认值        |
| 10 | `margin_bottom_mm`       | number       | —        | 0                            | 下边距（毫米），设 0 使用默认值        |
| 11 | `margin_left_mm`         | number       | —        | 0                            | 左边距（毫米），设 0 使用默认值        |
| 12 | `margin_right_mm`        | number       | —        | 0                            | 右边距（毫米），设 0 使用默认值        |
| 13 | `heading1_font`          | string       | —        | 预设默认值          | 一级标题字体名称              |
| 14 | `heading1_size_pt`       | number       | —        | 0                            | 一级标题字号（点），设 0 使用默认值 |
| 15 | `heading2_font`          | string       | —        | 预设默认值          | 二级标题字体名称              |
| 16 | `heading2_size_pt`       | number       | —        | 0                            | 二级标题字号（点），设 0 使用默认值 |
| 17 | `heading3_font`          | string       | —        | 预设默认值          | 三级标题字体名称              |
| 18 | `heading3_size_pt`       | number       | —        | 0                            | 三级标题字号（点），设 0 使用默认值 |

> 上一版本 (v0.0.2) 中的 `custom_template`（`type: file`）参数在 v0.0.3 中删除。原因：`type: file` 的工具参数会导致 Dify 工作流节点在 `get_workflow_tool_runtime()` 阶段卡止，从不下发 `dispatch/tool/invoke`（节点一直 running 直到超时）。如需自定义参考模板，请手动将自己的 `.docx` 作为 `template` profile 的默认参考使用。

## 网络与隐私

- **Mermaid Ink**（`https://mermaid.ink/img`）：当 `mermaid_enabled=true` 时，每个 `` ```mermaid `` 代码块会被发送到该公共服务进行渲染。仅传递 Mermaid 源码文本，不会发送其他文档内容。如需禁用，请设 `mermaid_enabled=false`。
- **Pandoc**：随 `pypandoc-binary` 轮子一同发布，首次调用无需从 GitHub 下载，不会发送任何用户数据。
- **临时文件**：Mermaid PNG、上传的模板等会写入插件沙盒临时目录，每次转换后自动清理。Windows 上路径可能包含系统用户名。

完整隐私说明：[../PRIVACY.md](../PRIVACY.md)。

## 部署调优（参考）

### 上下文 pip 镜像源

自完成部署的 Dify，若需为插件环境指定 pip 镜像，在 `docker/.env` 中设置：

```ini
# 🇨🇩 China — 阿里云镜像（推荐）
PIP_MIRROR_URL=https://mirrors.aliyun.com/pypi/simple/

# 🌐 其他地区 — 留空即可，pip 自动走 PyPI 官方源
# PIP_MIRROR_URL=
```

### 沙盒超时调整（可选）

```ini
PLUGIN_PYTHON_ENV_INIT_TIMEOUT=720   # Python 环境初始化超时（默认 120）
PLUGIN_MAX_EXECUTION_TIMEOUT=1800    # 插件执行超时（默认 600）
PIP_TRUSTED_HOST=mirrors.aliyun.com
```

修改后：`docker compose down && docker compose up -d`。

## 开发

```bash
pip install -r requirements.txt
pip install -r requirements-dev.txt
pytest tests/ -v
```

仓库：https://github.com/AlexMultiAgent/mdocx-converter（mdocx-converter monorepo 一部分）。
