# VS Code 插件对 Dify 插件能力对齐 + 模板重建 — 设计文档

日期：2026-11-14
范围：`VSC-plugin-MD2Docx-Converter/`（主），`dify-plugin-MD2Docx/`（模板与预设同步）

## 背景

`dify-plugin-MD2Docx/` 是 `VSC-plugin-MD2Docx-Converter/` 的 Python 移植版，功能已超前者。本次工作以 Dify 插件为参照补齐 VS Code 插件，并修正两边共有的模板缺陷。

### 差距清单

| 能力 | Dify | VS Code 现状 |
| --- | --- | --- |
| `official` 预设（GB/T 9704 公文） | 有（模板是 academic 的副本） | 缺 |
| `thesis` 预设（GB/T 7713 学位论文） | 有（复用 academic 模板） | 缺 |
| 内置模板数量 | 8（其中 2 个是副本） | 6 |
| Mermaid Ink HTTP 兜底渲染 | 有 | 缺，缺 mmdc 直接失败 |
| 独立 Mermaid 转图片命令 | 有（独立 tool） | 缺 |
| 预设级页边距默认值 | 有 | 缺 |
| 文档标题元数据 | 有 | 缺 |
| Mermaid 重试 / 并发 / 失败降级 | 有 | 缺 |
| 导出进度 UI 与取消 | 无 | 无 |
| 单元测试 | pytest 套件 | 仅一个指向已删除目录的死脚本 |

> **2026-11-14 更新**：Dify 侧原先只有「重试 + 失败降级」——`MERMAID_TOTAL_BUDGET_SECONDS` 定义了却从未读取，渲染是串行的，文档标题也没有写进 DOCX。这三项已在 Dify 侧补齐（中英分槽字体、样式按名称解析等配套修正同批完成），上表所列的 Dify 能力现已全部成立，VS Code 侧可以照常对齐。

### 模板实测结论

对现有 6 个模板做了「pandoc 转换 → 应用插件的样式覆盖 → 检查产物」的实测，结果如下。

**中文模板（3 个）基本健康**：单栏、A4、默认段落样式 `a1`（name=Normal）带 2 字符首行缩进、标题样式 ID `1`/`21`/`31` 正好落在插件的别名表里。

**英文模板（3 个）全部有缺陷**：

| 缺陷 | 证据 | 影响 |
| --- | --- | --- |
| 双栏排版 | `<w:cols w:num="2" w:space="288"/>` | 每一份英文导出都是双栏，报告/论文场景下是错的 |
| 标题自动编号 | `Heading1` 带 `<w:numPr><w:numId w:val="1"/></w:numPr>` | H1 被自动编号，且是期刊风 |
| 标题小型大写 | `Heading1` 带 `<w:smallCaps/>` | "The Title" 渲染成 small caps |
| 二级标题斜体 | `Heading2` 带 `<w:i/><w:iCs/>` 且 `ind left=144` | H2 变成斜体且缩进 |
| 英文正文用宋体 | 预设只有一个字体字段，XML 覆盖把 `w:ascii` 也写成 `SimSun` | 英文文档正文整篇宋体 |
| 段落样式 ID 非标准 | 默认段落样式是 `a`（不是 `Normal`），正文用 `FirstParagraph` 而该样式在模板里不存在 | 插件的样式覆盖靠别名表兜底，脆弱 |
| 默认字体带繁体中文字体 | `docDefaults` 里 `eastAsia="PMingLiU"` | 与本项目场景不符 |
| 页边距偏窄 | 上下 1009 twips（17.8mm）、左右 936 twips（16.5mm） | 报告场景留白不足 |

**关键约束**：Dify 的 `reference_{chinese,english}_official.docx` 与对应的 `academic` 文件 MD5 完全相同 —— official 预设的差异全部来自样式默认值，模板本身没有信息量。因此「复制 Dify 的 official 模板」没有价值，应该重建。

### 预设数据漂移

VS Code 侧 `STYLE_PROFILE_METADATA`（pandoc 层）与 `getProfileDocxDefaults`（XML 层）是两张独立的表，已经漂移：business 行距 1.25 vs 1.3、technical 1.2 vs 1.25，`package.json` 的 `enumDescriptions` 又写作 1.25。且两层的字体都是单字段，无法区分中西文。

## 目标

1. VS Code 插件在预设数量、模板数量、Mermaid 渲染能力上与 Dify 插件对齐。
2. 预设数据改为单一数据源，中西文字体分槽设置，消除层间漂移。
3. 重建全部内置模板，修复英文模板的双栏 / 标题遗留 / 字体问题，并新增真正的 official 与 thesis 模板。
4. 导出过程对用户可见、可取消；单张 Mermaid 图渲染失败不再导致整次导出失败。
5. 具备可运行的零依赖单元测试。

## 非目标

- 不重构 extension.ts 的整体架构（只按能力抽取纯模块）。
- 不引入新的 npm 运行时依赖（`adm-zip` 保持为唯一依赖）。
- 不实现公文的红头 / 发文字号 / 版记等版式要素 —— 模板只负责正文与标题排版，版头由使用者自行在 Word 中添加。
- 不实现单双页页码分置（odd/even footer），页码统一居中。

## 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 范围 | 完整对齐 Dify + 模板重建 | 用户选定 |
| Mermaid 默认行为 | 本地优先，API 兜底并告知 | 兼顾开箱即用与隐私透明 |
| 文档标题来源 | 自动探测首个 ATX 标题，设置项可覆盖 | 无需用户输入即可得到有意义标题 |
| 独立 Mermaid 命令 | 渲染选中块并插回光标 | 产物可直接复用 |
| 模板策略 | 全量重建 + 生成器 | 样式规则变成可审阅的数据，而不是二进制 |
| 模板数量 | 10 个（5 预设 × 中英） | thesis 是独立标准，值得有自己的模板 |
| 正文字体 | 中西文分开设 | 英文文档正文用 Times New Roman，中文文档正文用宋体 |
| 测试方案 | 零依赖 `node:test` | 不引入新依赖 |
| 代码组织 | 按能力抽取纯模块 | 纯模块不 import vscode，可被单元测试直接加载 |

---

## 1. 架构与模块划分

### 1.1 新增纯模块

新增 5 个模块，均**不得** `import * as vscode`，以保证可被 `node --test` 在 Extension Host 之外直接加载。

| 模块 | 职责 | 来源 |
| --- | --- | --- |
| `src/profiles.ts` | `PROFILE_PRESETS` 单一数据源；`normalizeStyleProfile`；`StyleProfile` 类型 | 搬出 `STYLE_PROFILE_METADATA`、`getProfileDocxDefaults`、`StyleProfile` |
| `src/language.ts` | CJK/Latin 语言检测；`ReferenceLanguage` 类型 | 搬出 `detectMarkdownLanguage`、`resolveReferenceLanguage`、语言相关类型 |
| `src/templates.ts` | 模板映射与候选路径计算（仅用 `fs`/`path`） | 搬出 `BUNDLED_REFERENCE_DOCX_BY_PROFILE_AND_LANGUAGE`、`getBundledReferenceDocxCandidates` |
| `src/mermaid.ts` | 代码块切分、pako 编码、Ink API 客户端、重试策略 | 搬出 `MERMAID_BLOCK_REGEX` 与 `prepareMarkdown` 中的切分逻辑；新增 API 客户端 |
| `src/document.ts` | 标题提取、文件名清理 | 新增 |

`src/document.ts` 导出：

- `extractDocumentTitle(markdownText: string): string | undefined` — 取首个 ATX 标题（H1–H6，行首 `#` 至多 6 个 + 空格），去除首尾空白与尾部 `#`。**不识别 Setext 标题**（`===` 下划线式），只认 ATX 形式。
- `resolveDocumentTitle(markdownText: string, configuredTitle: string, markdownPath: string): string` — 配置项优先，其次 H1，最后文件名（去扩展名）。
- `sanitizeFileName(name: string): string` — 替换 `<>:"/\|?*` 与控制字符为 `_`；空串回落为 `document`。

### 1.2 extension.ts 保留内容

以下依赖 vscode API，无法解耦，留在原地：
`activate` / `deactivate`、命令注册与菜单、`readSettings` / `readConfigValue`、输出路径解析、pandoc 子进程调用（`runPandoc` / `resolveExecutable` / `runExecutable`）、adm-zip 样式覆盖（`applyDocxStyleOverrides` 及其 XML 辅助函数）、`withProgress` 进度 UI、`openExportedDocx`。

`resolveReferenceDocx` 保留在 extension.ts（它用 `vscode.Uri` 与 `vscode.workspace.getWorkspaceFolder`），但把「候选路径计算」委托给 `src/templates.ts`。

### 1.3 单一数据源与中西文分槽

`src/profiles.ts` 导出 `PROFILE_PRESETS: Record<StyleProfile, ProfilePreset>`：

```ts
interface FontPair {
    ascii: string;    // w:ascii / w:hAnsi / w:cs
    eastAsia: string; // w:eastAsia
}

interface ProfilePreset {
    metadata: Record<string, string>;   // mainfont, CJKmainfont, monofont, fontsize, linestretch
    body: FontPair;
    bodySizePt?: number;
    heading1: FontPair;
    heading1SizePt?: number;
    heading2: FontPair;
    heading2SizePt?: number;
    heading3: FontPair;
    heading3SizePt?: number;
    lineSpacing?: number;
    marginTopMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
}
```

`DocxStyleOverride` 相应改为携带 `asciiFont` 与 `eastAsiaFont` 两个字段：

- 预设默认 → `asciiFont` 取 `body.ascii`，`eastAsiaFont` 取 `body.eastAsia`。
- 用户通过设置项显式指定字体（`bodyFont` / `headingNFont`）→ 同一个值同时写入两个槽位（用户明确指定了字体名，不再区分中西文）。

`buildPandocMetadata(settings)` 与 `buildDocxStyleOverrides(settings)` 都只读这一张表。

### 1.4 导出数据流

```
Markdown 文本
  → resolveDocumentTitle  → metadata.title
  → parseMermaidBlocks
      → 每个图：local mmdc  →  失败则 Mermaid Ink API（重试 / 并发 4）
          → 单图彻底失败：保留原 ```mermaid 代码块，不中断导出
  → Pandoc（--reference-doc, --metadata）
  → adm-zip 样式覆盖（含预设级页边距默认值）
  → 输出 DOCX
```

---

## 2. 功能规格

### 2.1 样式预设（6 档）

预设数值与 Dify 插件保持一致（Dify 的 `PROFILE_METADATA` 已经区分了 `mainfont` / `CJKmainfont`，本次只是把这个区分补到 XML 覆盖层）。

| profile | 正文 西文/中文 | 标题 西文/中文 | 标题字号 | 行距 | 页边距 上/下/左/右 (mm) |
| --- | --- | --- | --- | --- | --- |
| `template` | — | — | — | — | — |
| `academic` | Times New Roman / SimSun 12pt | Times New Roman / SimHei | 16 / 14 / 12 | 1.5 | 25.4 / 25.4 / 31.75 / 31.75 |
| `business` | Arial / Microsoft YaHei 11pt | Arial / Microsoft YaHei | 18 / 14 / 12 | 1.5 | 25.4 ×4 |
| `technical` | Arial / Microsoft YaHei 11pt | Arial / Microsoft YaHei | 16 / 14 / 12 | 1.35 | 19 ×4 |
| `official` | Times New Roman / FangSong 16pt | Times New Roman / SimHei → KaiTi → FangSong | 16 / 16 / 16 | 1.75 | 37 / 35 / 28 / 26 |
| `thesis` | Times New Roman / SimSun 12pt | Times New Roman / SimHei | 22 / 16 / 14 | 1.5 | 30 ×4 |

`official` 的三档标题字体对应 GB/T 9704 的一级 / 二级 / 三级标题：黑体 / 楷体 / 仿宋加粗。
`thesis` 的 22 / 16 / 14 与 30mm 页边距沿用 Dify 现有取值，保证两端一致。

对现有用户的行为变更：`business` 行距 1.25→1.5、`technical` 1.2→1.35、英文正文由宋体改为 Times New Roman。将在 README 中说明。

### 2.2 命令

新增 2 个导出命令，加入现有右键子菜单（3 项 → 5 项）：

| 命令 ID | 标题 | 强制预设 |
| --- | --- | --- |
| `mdocxConverter.exportOfficialDocument` | Export as Official Document (MDocx) | `official`，`referenceLanguage=auto` |
| `mdocxConverter.exportThesis` | Export as Thesis (MDocx) | `thesis`，`referenceLanguage=auto` |

新增 1 个独立 Mermaid 命令：

| 命令 ID | 标题 |
| --- | --- |
| `mdocxConverter.renderMermaidToImage` | Render Mermaid Diagram to Image (MDocx) |

`checkEnvironment` 命令保留，输出内容扩展（见 2.8）。

命令总数：5 → 8。

`renderMermaidToImage` 只进命令面板与编辑器右键菜单（`editor/context`），**不进**资源管理器右键子菜单 —— 那个子菜单的语义是「导出 DOCX」，混入会造成误解。

### 2.3 模板重建

#### 2.3.1 现状问题与做法

现有模板是二进制 .docx，样式规则不可见、不可审阅、不可复现；英文模板还带着从某个期刊模板继承来的双栏与 smallCaps。本次改为**生成器 + 声明式样式表**。

新增 `scripts/build-templates.js`（Node，依赖仅 `adm-zip`）：

1. 读取基底文件 `scripts/reference-base.docx`（由 `pandoc --print-default-data-file reference.docx` 在 pandoc 3.9.0.2 下导出后提交进仓库，保证重新生成是确定性的，不受本机 pandoc 版本影响）。
2. 按声明式样式表重写 `word/styles.xml` 中要替换的样式块。
3. 重写 `word/document.xml` 的 `sectPr`（页面尺寸、页边距、单栏）。
4. 注入页脚部件（居中页码）。
5. 输出 10 个 .docx 到 `multi-templates/`。

基底文件提供 OOXML 骨架（content types、rels、fontTable、numbering、settings、theme），生成器只负责我们自己关心的样式与页面设置。

#### 2.3.2 生成模板包含的样式

全部使用 pandoc 标准样式 ID，插件不再需要靠别名表兜底：

| 样式 ID | 说明 |
| --- | --- |
| `Normal` | 默认段落样式（`w:default="1"`），正文西文/中文分槽字体、字号、行距、首行缩进、两端对齐 |
| `BodyText` / `FirstParagraph` / `Compact` | 均基于 `Normal`，与正文一致 |
| `Heading1` … `Heading6` | 基于 `Normal`，带 `outlineLvl`、`keepNext/keepLines`、段前段后距、首行不缩进 |
| `SourceCode` | 等宽字体，浅灰底纹，左右缩进 |
| `VerbatimChar` | 字符级等宽样式 |

`SourceCode` / `VerbatimChar` 保留在模板里（而不是只靠插件的 XML 覆盖插入），这样模板在 Word 里单独打开也是对的。

#### 2.3.3 页面设置

| 预设 | 页面 | 页边距 (mm) | 行距 | 首行缩进 | 对齐 |
| --- | --- | --- | --- | --- | --- |
| academic | A4 | 25.4 / 25.4 / 31.75 / 31.75 | 1.5 倍 | 2 字符 | 两端对齐 |
| business | A4 | 25.4 ×4 | 1.5 倍 | 2 字符 | 两端对齐 |
| technical | A4 | 19 ×4 | 1.35 倍 | 2 字符 | 两端对齐 |
| official | A4 | 37 / 35 / 28 / 26 | 固定值 29 磅 | 2 字符 | 两端对齐 |
| thesis | A4 | 30 ×4 | 1.5 倍 | 2 字符 | 两端对齐 |

- 固定值 29 磅：版心高 = 297 − 37 − 35 = 225 mm，225 / 22 行 ≈ 10.23 mm ≈ 29 磅，符合 GB/T 9704「每面 22 行」。
- 首行缩进 2 字符按各预设正文字号换算成 twips（12pt → 480，11pt → 440，16pt → 640）。
- 所有模板单栏。
- 所有模板带居中页码页脚（宋体四号）。

标题排布：`official` 与 `thesis` 的 `Heading1` 居中（对应文档标题 / 章标题），其余预设左对齐；`official` 的 H2/H3 缩进 2 字符。

#### 2.3.4 产物清单

10 个文件，两端文件名一一对应：

```
reference_english_academic.docx   reference_chinese_academic.docx
reference_english_business.docx   reference_chinese_business.docx
reference_english_technical.docx  reference_chinese_technical.docx
reference_english_official.docx   reference_chinese_official.docx
reference_english_thesis.docx     reference_chinese_thesis.docx
```

`template` 预设仍复用 academic。

#### 2.3.5 Dify 侧同步

- `dify-plugin-MD2Docx/multi-templates/` 换成同一批 10 个文件（由 `scripts/sync-templates.sh` 复制，脚本已按 8 个模板写死，需扩到 10 个）。
- Dify 的 `TEMPLATE_MAP`：`thesis` 从复用 academic 改为指向 `reference_{en,zh}_thesis.docx`；`official` 指向新的 official 文件。
- Dify 的 `apply_style_overrides` 改为西文 / 中文字体分槽写入（python-docx 的 `font.name` 只设 ascii/hAnsi，`w:eastAsia` 需用 lxml 单独设置 `rFonts`）。
- Dify 的 `PROFILE_DEFAULTS` 补页边距默认值（已有），行距对齐到统一后的值（business 1.5、technical 1.35）。

### 2.4 Mermaid 渲染

**新增设置**

| 设置 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mdocxConverter.mermaidRenderer` | `auto` \| `local` \| `api` | `auto` | `auto` = 先本地 mmdc，失败则走 API；`local` = 仅本地，缺 mmdc 直接报错；`api` = 仅走 API |
| `mdocxConverter.mermaidApiUrl` | string | `https://mermaid.ink` | Mermaid Ink 实例地址，可指向自建服务 |

**编码格式**（与 Dify 的 pako 格式逐字节兼容）
```
JSON.stringify({ code: <diagram> })  →  zlib deflate  →  base64url 无 padding
```
Node 侧实现：`zlib.deflateSync(Buffer.from(json))` → `buf.toString('base64url')`。
请求：`GET <apiUrl>/img/pako:<encoded>`，30 秒单请求超时。

**可靠性策略**（对齐 Dify）
- 每次请求最多尝试 3 次，退避 1s / 2s。
- 单请求超时 30s，全部图表共享 120s 总预算。
- 并发 4 路渲染。
- 单张图彻底失败 → 在 Markdown 中保留原始 ` ```mermaid ` 代码块，导出继续。

**隐私告知**
当且仅当实际调用了远程 API 时：
- 输出面板记录一行 `Mermaid Ink API fallback used — diagram content was sent to <host>`。
- 首次使用远程渲染时弹出一次性通知，含「打开设置」按钮。一次性状态用 `context.globalState` 的键 `mdocxConverter.mermaidApiNoticeShown` 持久化；用户点「打开设置」时同样置位，避免重复打扰。

### 2.5 文档标题

- 新增设置 `mdocxConverter.documentTitle`（string，默认 `""`）。
- 解析优先级：设置项非空 → 首个 ATX 标题（H1–H6）→ Markdown 文件名（去扩展名）。
- 通过 `--metadata title=<值>` 传给 pandoc，最终写入 DOCX 核心属性 `dc:title`。
- 不向正文插入标题段（避免与模板自带标题样式冲突）。

### 2.6 独立 Mermaid 命令

`mdocxConverter.renderMermaidToImage` 行为：
1. 取当前编辑器选区；选区为空时，取光标所在的 ` ```mermaid ` 代码块；两者皆无 → 提示用户。
2. 按 2.4 的同一套解析规则渲染（`auto` = local 失败则 api；`local` / `api` 各自只用一条路径）。
3. 输出到 `<Markdown 同级目录>/mermaid-images/mermaid-<yyyyMMdd-HHmmss>.<png|svg>`，扩展名由 `mermaidOutputFormat` 决定。
4. 在光标处插入 `![Mermaid Diagram](mermaid-images/<文件名>)`。
5. 用相对路径引用，插入后光标停在插入内容之后。

### 2.7 进度与取消

**导出进度**
`vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: true })`，阶段：
1. 准备 Markdown
2. 渲染图表 `n/m`
3. 调用 Pandoc
4. 应用样式
5. 完成

**取消**
取消信号触发后：终止所有在跑的子进程（pandoc 与 mmdc，统一登记到进程列表，逐个 `child.kill()`），清理临时目录，抛出用户可读的取消提示。

### 2.8 诊断

`checkEnvironment` 命令输出：
- Pandoc 路径与版本
- Mermaid CLI 路径与版本（若可用）
- Mermaid Ink API 连通性（若 `mermaidRenderer` 允许走 API）
- 内置模板数量（应为 10）
- 当前生效的 `styleProfile`

### 2.9 错误处理

| 场景 | 行为 |
| --- | --- |
| pandoc 不存在 | 保留现有提示文案 + 安装指引 |
| mmdc 不存在且 `mermaidRenderer=local` | 保留现有提示文案 + `npm i -g @mermaid-js/mermaid-cli` |
| mmdc 不存在且 `mermaidRenderer=auto` | 走 API 兜底 |
| API 不可达 | 输出面板记录失败原因；相关图降级为代码块；导出继续 |
| 单张图渲染失败 | 降级为代码块，导出继续 |
| 全部图都失败 | 仍导出成功（图中保留代码块），输出面板汇总提示 |
| pandoc 转换失败 | 保留现有的 stderr 模式匹配与用户友好提示 |
| 用户取消 | 终止子进程、清理临时目录、提示已取消 |

---

## 3. 测试与文档

### 3.1 单元测试

位置：`test/unit/*.test.js`，运行器为 Node 内置 `node:test` + `node:assert`，**零新增依赖**。

`npm test` = `npm run compile && node --test test/unit/`。
测试加载编译产物 `out/*.js`（CommonJS），即实际发布的代码。

| 文件 | 覆盖点 |
| --- | --- |
| `profiles.test.js` | 6 个 profile 齐全；official 页边距 37/35/28/26；thesis 标题字号 22/16/14；metadata 与 DOCX 默认值中的行距一致；中西文字体分槽正确；非法 profile 归一化为 `template` |
| `language.test.js` | CJK 阈值（≥40 或 >15% Latin）；空文本回落 `english` |
| `mermaid.test.js` | 代码块切分（多块、含嵌套反引号、无代码块）；pako 编码往返（`zlib.inflateSync` 解回 JSON 并比对 `code`） |
| `document.test.js` | 标题提取（首行 / 非首行 / 无标题 / Setext 不识别）；尾部 `#` 剥离；设置项优先级；文件名兜底与非法字符清理 |
| `templates.test.js` | 10 个模板文件存在；每个模板单栏、A4 尺寸正确；`Normal` 为默认段落样式且带首行缩进 |

### 3.2 模板生成器的自检

`npm run build:templates` 重新生成 10 个模板。生成结果由 `test/unit/templates.test.js` 校验：读回每个 .docx，检查 sectPr 单栏 + A4 + 页边距、`Normal` 的 `w:default="1"`、字体分槽正确、样式 ID 齐全、中英缩进差异、页脚部件存在。

### 3.3 端到端测试

`test_full_pipeline.js` 现有版本指向已删除的 `examples/` 目录且硬编码了本机扩展安装路径，属于死脚本。重写为 `test/e2e/run.js`：接受 markdown 路径参数，依次验证每个预设的导出产物（存在、可解压、sectPr 单栏、正文样式符合预设）。接入 `npm run test:e2e`，需要本机 pandoc，不纳入默认测试。

### 3.4 文档

| 文件 | 更新内容 |
| --- | --- |
| `CLAUDE.md`（根） | 模板数量 8 → 10；模板生成流程说明；同步脚本改为 10 个模板 |
| `VSC-plugin-MD2Docx-Converter/CLAUDE.md` | 模块划分、新命令、新设置、测试命令、预设表、模板生成器说明 |
| `VSC-plugin-MD2Docx-Converter/README.md` | 功能列表、设置表、命令表、预设对比表、模板说明、行距与字体变更说明 |
| `dify-plugin-MD2Docx/CLAUDE.md` | 模板同步说明（两边各 10 个文件）、字体分槽说明 |
| `dify-plugin-MD2Docx/README.md` | 预设表与模板数量同步 |

### 3.5 版本

`package.json` 版本 `0.2.14` → `0.3.0`（新增预设、命令、设置与模板重建，属 minor 变更）。

---

## 4. 实施顺序

1. 抽取纯模块 `profiles.ts` / `language.ts` / `templates.ts` / `document.ts`，extension.ts 改为引用，行为不变。
2. 单元测试落地（此时已可测）。
3. `PROFILE_PRESETS` 扩到 6 档并引入字体分槽；`DocxStyleOverride` 改为双字体字段；页边距默认值接入 `updateDocumentMargins`。
4. 写模板生成器 + 基底文件 + 样式表，生成 10 个模板；同步到 Dify。
5. Dify 侧同步：`TEMPLATE_MAP`（thesis → 独立模板）、`apply_style_overrides` 字体分槽、行距对齐。
6. 新增 2 个导出命令 + 菜单条目；更新 `package.json` 的 `contributes`。
7. `src/mermaid.ts` 补 Ink API 客户端、重试、并发、失败降级；新增 `mermaidRenderer` / `mermaidApiUrl` 设置。
8. 标题提取与 `--metadata title` 接入。
9. 独立 Mermaid 命令。
10. `withProgress` 进度 UI 与取消。
11. `checkEnvironment` 扩展。
12. 重写 `test/e2e/run.js`；补文档、版本号，提交。

## 5. 风险与注意事项

- **行距与字体变更影响现有用户**：business 行距 1.25→1.5、technical 1.2→1.35、英文正文宋体→Times New Roman，属行为变更，需在 README 中明确说明。
- **模板重建会改变既有产出**：所有导出都会换成新模板的排版（单栏、居中页码、统一首行缩进）。这是修 bug，但属于可见变化。
- **生成器与基底文件**：基底 `reference-base.docx` 提交进仓库以保证生成确定性；不要在没跑 `npm run build:templates` 的情况下手改 `multi-templates/` 里的 .docx。
- **`sync-templates.sh` 需扩到 10 个模板**，否则 Dify 侧收不到 thesis 模板。
- **Dify 侧字体分槽**是 python-docx 的已知坑：`font.name` 只写 ascii/hAnsi，`w:eastAsia` 必须用 lxml 直接操作 `rFonts` 元素。
- **node:test 加载 `out/`**：`npm test` 会自动触发编译；`test:e2e` 需本地 pandoc，不纳入默认流程。
- **围栏剥离的已知边界**（`src/document.ts`）：`FENCED_CODE_BLOCK_REGEX` 只认反引号围栏，不认 `~~~`；闭合围栏必须与开启围栏等长（CommonMark 允许更长）；未闭合的围栏不剥离。这三种情况下围栏内的 `#` 注释行会被当成文档标题。仅影响 DOCX 核心属性里的标题，不影响正文排版。
- **既有命令 ID 保持不变**，其注册方式、参数与菜单位置不变；产出随预设值统一而变化（行距、字体）。
