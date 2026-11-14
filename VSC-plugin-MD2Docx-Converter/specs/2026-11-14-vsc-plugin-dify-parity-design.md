# VS Code 插件对 Dify 插件能力对齐 — 设计文档

日期：2026-11-14
范围：`VSC-plugin-MD2Docx-Converter/`（主），`dify-plugin-MD2Docx/`（仅模板同步与文档）

## 背景

`dify-plugin-MD2Docx/` 是 `VSC-plugin-MD2Docx-Converter/` 的 Python 移植版，功能已超前者。本次工作以 Dify 插件为参照，补齐 VS Code 插件缺失的能力，使两端能力对齐。

差距清单（对照结论）：

| 能力 | Dify | VS Code 现状 |
|---|---|---|
| `official` 预设（GB/T 9704 公文） | 有 | 缺 |
| `thesis` 预设（GB/T 7713 学位论文） | 有 | 缺 |
| 内置模板数量 | 8 | 6 |
| Mermaid Ink HTTP 兜底渲染 | 有 | 缺，缺 mmdc 直接失败 |
| 独立 Mermaid 转图片命令 | 有（独立 tool） | 缺 |
| 预设级页边距默认值 | 有 | 缺 |
| 文档标题元数据 | 有 | 缺 |
| Mermaid 重试 / 并发 / 失败降级 | 有 | 缺 |
| 导出进度 UI 与取消 | 无 | 无（需新建） |
| 单元测试 | pytest 套件 | 仅一个游离脚本 |

### 已确认的关键事实

- Dify 的 `reference_{chinese,english}_official.docx` 与 `reference_{chinese,english}_academic.docx` **字节完全相同**（MD5 一致）。official 预设的差异全部来自样式默认值，而非模板本身。
- VS Code 侧 `STYLE_PROFILE_METADATA`（pandoc 层）与 `getProfileDocxDefaults`（XML 层）是两张独立的表，已发生漂移：business 行距 1.25 vs 1.3、technical 1.2 vs 1.25；`package.json` 的 `enumDescriptions` 又写作 1.25。

## 目标

1. VS Code 插件在预设数量、模板数量、Mermaid 渲染能力上与 Dify 插件对齐。
2. 消除预设数据在 pandoc 层与 XML 层之间的漂移，改为单一数据源。
3. 导出过程对用户可见、可取消；单张 Mermaid 图渲染失败不再导致整次导出失败。
4. 具备可运行的零依赖单元测试。

## 非目标

- 不重构 extension.ts 的整体架构（用户已确认走「按能力抽取纯模块」，非全面拆分）。
- 不改变 Dify 插件的运行时行为，仅同步模板文件与文档。
- 不引入新的 npm 运行时依赖（`adm-zip` 保持为唯一依赖）。

## 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| 范围 | 完整对齐 Dify | 用户选定 |
| Mermaid 默认行为 | 本地优先，API 兜底并告知 | 兼顾开箱即用与隐私透明 |
| 文档标题来源 | 自动探测首个 H1，设置项可覆盖 | 无需用户输入即可得到有意义标题 |
| 独立 Mermaid 命令 | 渲染选中块并插回光标 | 产物可直接复用 |
| official 模板 | 复制出独立文件，两边各 8 个 | 与 Dify 目录一一对应，便于同步流程 |
| 测试方案 | 零依赖 `node:test` | 不引入新依赖 |
| 代码组织 | 按能力抽取纯模块 | 纯模块不 import vscode，可被单元测试直接加载 |

---

## 1. 架构与模块划分

### 1.1 新增纯模块

新增 5 个模块，均**不得** `import * as vscode`，以保证可被 `node --test` 在 Extension Host 之外直接加载。

| 模块 | 职责 | 来源 |
|---|---|---|
| `src/profiles.ts` | `PROFILE_PRESETS` 单一数据源；`normalizeStyleProfile`；`StyleProfile` 类型 | 从 extension.ts 搬出 `STYLE_PROFILE_METADATA`、`getProfileDocxDefaults`、`StyleProfile` |
| `src/language.ts` | CJK/Latin 语言检测 | 搬出 `detectMarkdownLanguage`、`resolveReferenceLanguage`、语言相关类型 |
| `src/templates.ts` | 模板映射与候选路径计算（仅用 `fs`/`path`） | 搬出 `BUNDLED_REFERENCE_DOCX_BY_PROFILE_AND_LANGUAGE`、`getBundledReferenceDocxCandidates` |
| `src/mermaid.ts` | 代码块切分、pako 编码、Ink API 客户端、重试策略 | 搬出 `MERMAID_BLOCK_REGEX` 与 `prepareMarkdown` 中的切分逻辑；新增 API 客户端 |
| `src/document.ts` | 标题提取、文件名清理 | 新增 |

`src/document.ts` 导出：

- `extractDocumentTitle(markdownText: string): string | undefined` — 取首个 ATX H1（行首 `#` 至多 6 个 + 空格），去除首尾空白与尾部 `#`。**不识别 Setext 标题**（`===` 下划线式），只认 ATX 形式。
- `resolveDocumentTitle(markdownText: string, configuredTitle: string, markdownPath: string): string` — 配置项优先，其次 H1，最后文件名（去扩展名）。
- `sanitizeFileName(name: string): string` — 替换 `<>:"/\|?*` 与控制字符为 `_`；空串回落为 `document`。

### 1.2 extension.ts 保留内容

以下依赖 vscode API，无法解耦，留在原地：
`activate` / `deactivate`、命令注册与菜单、`readSettings` / `readConfigValue`、输出路径解析、pandoc 子进程调用（`runPandoc` / `resolveExecutable` / `runExecutable`）、adm-zip 样式覆盖（`applyDocxStyleOverrides` 及其 XML 辅助函数）、`withProgress` 进度 UI、`openExportedDocx`。

### 1.3 单一数据源

`src/profiles.ts` 导出 `PROFILE_PRESETS: Record<StyleProfile, ProfilePreset>`，每个条目同时携带 pandoc metadata 与 DOCX 默认值：

```ts
interface ProfilePreset {
    metadata: Record<string, string>;   // mainfont, CJKmainfont, monofont, fontsize, linestretch
    bodyFont?: string;
    bodySizePt?: number;
    heading1Font?: string;
    heading1SizePt?: number;
    heading2Font?: string;
    heading2SizePt?: number;
    heading3Font?: string;
    heading3SizePt?: number;
    lineSpacing?: number;
    marginTopMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
}
```

`buildPandocMetadata(settings)` 与 `buildDocxStyleOverrides(settings)` 都改为只读这一张表，从而消除漂移。

### 1.4 导出数据流

```
Markdown 文本
  → extractDocumentTitle / resolveDocumentTitle  → metadata.title
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

数值全部对齐 Dify 插件。

| profile | 正文 | 标题 1/2/3 | 行距 | 页边距 上/下/左/右 (mm) | pandoc metadata |
|---|---|---|---|---|---|
| `template` | — | — | — | — | — |
| `academic` | SimSun 12 | SimHei 16/14/12 | 1.5 | 25.4 ×4 | Times New Roman / SimSun / 12pt / 1.5 |
| `business` | Arial 11 | Arial 18/14/12 | 1.5 | 25.4 ×4 | Arial / Microsoft YaHei / 11pt / 1.5 |
| `technical` | Arial 11 | Arial 16/14/12 | 1.35 | 19 ×4 | Arial / Microsoft YaHei / Consolas / 11pt / 1.35 |
| `official` | FangSong 16 | SimHei 16 / KaiTi 16 / FangSong 16 | 1.75 | 37 / 35 / 28 / 26 | Times New Roman / FangSong / 16pt / 1.75 |
| `thesis` | SimSun 12 | SimHei 22/16/14 | 1.5 | 30 ×4 | Times New Roman / SimSun / 12pt / 1.5 |

对现有用户的输出影响：`business` 行距 1.25→1.5，`technical` 1.2→1.35。这是与 Dify 对齐的有意变更，将在 README 与 CHANGELOG 中说明。

### 2.2 命令

新增 2 个导出命令，加入现有右键子菜单（3 项 → 5 项）：

| 命令 ID | 标题 | 强制预设 |
|---|---|---|
| `mdocxConverter.exportOfficialDocument` | Export as Official Document (MDocx) | `official`，`referenceLanguage=auto` |
| `mdocxConverter.exportThesis` | Export as Thesis (MDocx) | `thesis`，`referenceLanguage=auto` |

新增 1 个独立 Mermaid 命令：

| 命令 ID | 标题 |
|---|---|
| `mdocxConverter.renderMermaidToImage` | Render Mermaid Diagram to Image (MDocx) |

`checkEnvironment` 命令保留，输出内容扩展（见 2.7）。

命令总数：5 → 8。

### 2.3 模板

- 从 `dify-plugin-MD2Docx/multi-templates/` 复制 `reference_chinese_official.docx`、`reference_english_official.docx` 到 `VSC-plugin-MD2Docx-Converter/multi-templates/`。两边各 8 个文件，文件名一一对应。
- `thesis` 预设映射到 academic 模板（与 Dify 一致）。
- `BUNDLED_REFERENCE_DOCX_BY_PROFILE_AND_LANGUAGE` 扩展为 6 个 profile。

### 2.4 Mermaid 渲染

**新增设置**

| 设置 | 类型 | 默认 | 说明 |
|---|---|---|---|
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
- 解析优先级：设置项非空 → 首个 H1 → Markdown 文件名（去扩展名）。
- 通过 `--metadata title=<值>` 传给 pandoc，最终写入 DOCX 核心属性 `dc:title`。
- 不向正文插入标题段（避免与模板自带标题样式冲突）。

### 2.6 独立 Mermaid 命令

`mdocxConverter.renderMermaidToImage` 行为：
1. 取当前编辑器选区；选区为空时，取光标所在的 ` ```mermaid ` 代码块；两者皆无 → 提示用户。
2. 按 2.4 的同一套解析规则渲染（`auto` = local 失败则 api；`local` / `api` 各自只用一条路径）。
3. 输出到 `<Markdown 同级目录>/mermaid-images/mermaid-<yyyyMMdd-HHmmss>.<png|svg>`，扩展名由 `mermaidOutputFormat` 决定。
4. 在光标处插入 `![Mermaid Diagram](mermaid-images/<文件名>)`。
5. 用相对路径引用，插入后光标停在插入内容之后。

### 2.7 进度、取消与诊断

**导出进度**
`vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, cancellable: true })`，阶段：
1. 准备 Markdown
2. 渲染图表 `n/m`
3. 调用 Pandoc
4. 应用样式
5. 完成

**取消**
取消信号触发后：终止所有在跑的子进程（pandoc 与 mmdc，统一登记到进程列表，逐个 `child.kill()`），清理临时目录，抛出用户可读的取消提示。

**`checkEnvironment` 扩展输出**
- Pandoc 路径与版本
- Mermaid CLI 路径与版本（若可用）
- Mermaid Ink API 连通性（若 `mermaidRenderer` 允许走 API）
- 内置模板数量（应为 8）
- 当前生效的 `styleProfile`

### 2.8 错误处理

| 场景 | 行为 |
|---|---|
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
|---|---|
| `profiles.test.js` | 6 个 profile 齐全；official 页边距 37/35/28/26；thesis 标题字号 22/16/14；metadata 与 DOCX 默认值中的行距一致；非法 profile 归一化为 `template` |
| `language.test.js` | CJK 阈值（≥40 或 >15% Latin）；空文本回落 `english` |
| `mermaid.test.js` | 代码块切分（多块、含嵌套反引号、无代码块）；pako 编码往返（`zlib.inflateSync` 解回 JSON 并比对 `code`） |
| `document.test.js` | H1 提取（首行 / 非首行 / 无 H1）；尾部 `#` 剥离；设置项优先级；文件名兜底与非法字符清理 |

### 3.2 端到端测试

现有 `test_full_pipeline.js` 保留并同步更新（覆盖新增的 official/thesis 预设与 Mermaid API 路径），接入 `npm run test:e2e`。该脚本依赖本机安装 pandoc，非默认测试。

### 3.3 文档

| 文件 | 更新内容 |
|---|---|
| `CLAUDE.md`（根） | 模板数量描述 6 → 8；去掉「VSC 无 official 模板」的说明 |
| `VSC-plugin-MD2Docx-Converter/CLAUDE.md` | 模块划分、新命令、新设置、测试命令、预设表 |
| `VSC-plugin-MD2Docx-Converter/README.md` | 功能列表、设置表、命令表、预设对比表、行距变更说明 |
| `dify-plugin-MD2Docx/CLAUDE.md` | 模板同步说明（两边各 8 个文件） |

### 3.4 版本

`package.json` 版本 `0.2.14` → `0.3.0`（新增预设、命令与设置，属 minor 变更）。

---

## 4. 实施顺序

1. 抽取纯模块 `profiles.ts` / `language.ts` / `templates.ts` / `document.ts`，extension.ts 改为引用，行为不变。
2. 单元测试落地（此时已可测）。
3. 扩展 `PROFILE_PRESETS` 至 6 档，同步数值到 Dify 的取值；页边距默认值接入 `updateDocumentMargins`。
4. 复制 official 模板到 VSC；扩展模板映射。
5. 新增 2 个导出命令 + 菜单条目。
6. `src/mermaid.ts` 补 Ink API 客户端、重试、并发、失败降级；新增 `mermaidRenderer` / `mermaidApiUrl` 设置。
7. 标题提取与 `--metadata title` 接入。
8. 独立 Mermaid 命令。
9. `withProgress` 进度 UI 与取消。
10. `checkEnvironment` 扩展。
11. 测试、文档、版本号，提交。

## 5. 风险与注意事项

- **行距变更影响现有用户**：business 1.25→1.5、technical 1.2→1.35 属行为变更，需在 README 中明确说明。
- **Dify 的 official 模板与 academic 字节相同**：复制后 VSC 侧的 official 文件同样是 academic 的副本。若日后要真正区分模板，需在 Dify 侧先制作，VSC 侧按仓库 CLAUDE.md 的模板同步流程跟进。
- **node:test 加载 `out/`**：CI 若只跑 `npm test` 会自动触发编译；`test:e2e` 需本地 pandoc，不纳入默认流程。
- **不应破坏现有命令**：5 个既有命令 ID 保持不变，其注册方式、参数与菜单位置不变。它们的**产出**会随预设值统一而变化（business / technical 行距），这属于预期的对齐行为。
- **`renderMermaidToImage` 的入口**：只进命令面板与编辑器右键菜单（`editor/context`），**不进**资源管理器右键子菜单——那个子菜单的语义是「导出 DOCX」，混入会造成误解。
