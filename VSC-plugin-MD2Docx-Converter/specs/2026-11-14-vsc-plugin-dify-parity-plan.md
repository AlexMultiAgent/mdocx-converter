# VS Code 插件对齐 Dify + 模板重建 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 VS Code 扩展的能力补齐到 Dify 插件水平（6 档预设、Mermaid Ink 兜底、独立 Mermaid 命令、文档标题、导出进度），并重建全部内置模板，修复英文模板双栏 / 标题遗留 / 中英字体不分槽的问题。

**Architecture:** 把 extension.ts 里的纯逻辑抽到 5 个不依赖 `vscode` 的模块（profiles / language / templates / mermaid / document），使它们能被 `node:test` 在 Extension Host 之外直接加载。预设数据合并为 `src/profiles.ts` 里的单一数据源 `PROFILE_PRESETS`，中西文字体分槽（`ascii` / `eastAsia`）。新增 `scripts/build-templates.js`，以 pandoc 官方 reference.docx 为基底、用声明式样式表生成 10 个模板（5 预设 × 中英）。

**Tech Stack:** TypeScript（ES2022 / CommonJS）、Node 内置 `node:test`、`adm-zip`（唯一运行时依赖）、pandoc CLI、VS Code Extension API。

**Spec:** `VSC-plugin-MD2Docx-Converter/specs/2026-11-14-vsc-plugin-dify-parity-design.md`

---

## 文件结构

### 新建

| 路径 | 职责 |
|---|---|
| `src/profiles.ts` | `PROFILE_PRESETS`（运行时预设单一数据源）、`TEMPLATE_LAYOUT`（模板排版参数，仅模板生成器消费）、`normalizeStyleProfile`、`StyleProfile` / `FontPair` 类型 |
| `src/language.ts` | `detectMarkdownLanguage`、`resolveReferenceLanguage`、`ReferenceLanguage` / `ReferenceLanguageSetting` 类型 |
| `src/templates.ts` | 内置模板映射表与候选路径计算 |
| `src/mermaid.ts` | mermaid 代码块切分、pako 编码、Mermaid Ink HTTP 客户端、重试与并发控制 |
| `src/document.ts` | 文档标题提取、文件名清理 |
| `scripts/build-templates.js` | 模板生成器：读基底 → 改写 styles.xml / document.xml / 页脚 → 输出 10 个 .docx |
| `scripts/reference-base.docx` | pandoc 官方 reference.docx 基底（提交进仓库保证生成确定性） |
| `test/unit/profiles.test.js` | 预设表完整性、中西文分槽、行距一致性 |
| `test/unit/language.test.js` | CJK/Latin 检测阈值 |
| `test/unit/mermaid.test.js` | 代码块切分、pako 编码往返 |
| `test/unit/document.test.js` | 标题提取、文件名清理 |
| `test/unit/templates.test.js` | 10 个模板存在、单栏、A4、默认样式正确 |
| `test/e2e/run.js` | 端到端：逐预设导出并校验产物 |

### 修改

| 路径 | 改动 |
|---|---|
| `src/extension.ts` | 引用新模块；`DocxStyleOverride` 改双字体字段；6 档预设；页边距默认值；Mermaid API 兜底；标题元数据；3 个新命令；`withProgress` 进度与取消；`checkEnvironment` 扩展 |
| `package.json` | 新增 `test` / `test:e2e` / `build:templates` 脚本；3 个新命令与菜单；4 个新设置；`styleProfile` 枚举扩展；版本 0.3.0 |
| `multi-templates/*.docx` | 由生成器重建，共 10 个 |
| `scripts/sync-templates.sh` | 模板清单 8 → 10 |
| `dify-plugin-MD2Docx/src/md2docx.py` | `TEMPLATE_MAP` 指向新模板；`PROFILE_DEFAULTS` 字体分槽；`_set_font` 拆 ascii/eastAsia；行距对齐 |
| `dify-plugin-MD2Docx/multi-templates/*.docx` | 同步为同一批 10 个 |
| `CLAUDE.md`（根）、`VSC-plugin-MD2Docx-Converter/CLAUDE.md`、两份 `README.md` | 架构、模板流程、命令 / 设置表、预设表 |

---

## Phase 1 — 基础设施（重构 + 模板）

### Task 1: 测试骨架与 npm 脚本

**Files:**
- Modify: `package.json`（`scripts` 段）
- Create: `test/unit/smoke.test.js`

- [ ] **Step 1: 写一个会失败的冒烟测试**

`test/unit/smoke.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');

test('test harness runs', () => {
    assert.equal(1 + 1, 2);
});
```

- [ ] **Step 2: 运行测试确认它能跑通**

Run: `node --test "test/unit/**/*.test.js"`
Expected: PASS，输出 `ℹ pass 1`

> 注意：Node 24 的 `--test` 不再递归目录参数，`node --test test/unit/` 会失败（它把目录当模块 require）。必须用 glob 形式，且引号要保留（Windows 下 shell 会吃掉未加引号的 `*`）。所有测试文件必须命名为 `*.test.js` 才会被 glob 匹配。

- [ ] **Step 3: 在 package.json 加入脚本**

把 `scripts` 段改成：

```json
  "scripts": {
    "compile": "tsc -p ./",
    "package": "vsce package --allow-missing-repository",
    "watch": "tsc -watch -p ./",
    "vscode:prepublish": "npm run compile",
    "test": "npm run compile && node --test \"test/unit/**/*.test.js\"",
    "test:e2e": "node test/e2e/run.js",
    "build:templates": "npm run compile && node scripts/build-templates.js"
  },
```

- [ ] **Step 4: 运行 npm test 确认通过**

Run: `npm test`
Expected: `tsc` 无错误，随后 `ℹ pass 1`

- [ ] **Step 5: 提交**

```bash
git add package.json test/unit/smoke.test.js
git commit -m "chore: add node:test harness and npm test scripts"
```

---

### Task 2: 抽取 `src/document.ts` 与 `src/language.ts`

**Files:**
- Create: `src/document.ts`
- Create: `src/language.ts`
- Modify: `src/extension.ts`
- Test: `test/unit/document.test.js`、`test/unit/language.test.js`

- [ ] **Step 1: 写失败的测试**

`test/unit/document.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDocumentTitle, resolveDocumentTitle, sanitizeFileName } = require('../../out/document.js');

test('extractDocumentTitle returns the first ATX H1', () => {
    assert.equal(extractDocumentTitle('# 标题\n\n正文'), '标题');
    assert.equal(extractDocumentTitle('前言\n\n# 第二段里的 H1'), '第二段里的 H1');
});

test('extractDocumentTitle strips trailing hashes and whitespace', () => {
    assert.equal(extractDocumentTitle('##   Spaced Title   ##'), 'Spaced Title');
});

test('extractDocumentTitle ignores setext headings', () => {
    assert.equal(extractDocumentTitle('Setext\n======\n'), undefined);
});

test('extractDocumentTitle accepts any ATX heading level', () => {
    assert.equal(extractDocumentTitle('## 只有二级标题'), '只有二级标题');
    assert.equal(extractDocumentTitle('### 三级标题'), '三级标题');
});

test('extractDocumentTitle ignores seven or more hashes', () => {
    assert.equal(extractDocumentTitle('####### 不是标题'), undefined);
});

test('resolveDocumentTitle prefers the configured title', () => {
    assert.equal(resolveDocumentTitle('# From H1', 'Configured', '/tmp/a.md'), 'Configured');
});

test('resolveDocumentTitle falls back to the H1 then the filename', () => {
    assert.equal(resolveDocumentTitle('# From H1', '', '/tmp/a.md'), 'From H1');
    assert.equal(resolveDocumentTitle('no heading', '', '/tmp/report.md'), 'report');
});

test('sanitizeFileName replaces illegal characters', () => {
    assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
    assert.equal(sanitizeFileName('   '), 'document');
    assert.equal(sanitizeFileName('正常文件名'), '正常文件名');
});
```

`test/unit/language.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectMarkdownLanguage, resolveReferenceLanguage } = require('../../out/language.js');

test('detectMarkdownLanguage picks chinese for CJK-heavy text', () => {
    assert.equal(detectMarkdownLanguage('这是一段完全由中文构成的文本。'.repeat(20)), 'chinese');
});

test('detectMarkdownLanguage picks english for latin text', () => {
    assert.equal(detectMarkdownLanguage('This is a plain english paragraph about nothing.'.repeat(20)), 'english');
});

test('detectMarkdownLanguage picks chinese at the 40-character threshold', () => {
    assert.equal(detectMarkdownLanguage('中'.repeat(40)), 'chinese');
    assert.equal(detectMarkdownLanguage('中'.repeat(39) + 'a'.repeat(300)), 'english');
});

test('detectMarkdownLanguage picks chinese below the threshold when there is no latin text', () => {
    // The detection rule is "CJK count >= 40 OR CJK count > 15% of the latin count".
    // With zero latin characters the ratio clause is already satisfied, so a
    // Chinese-only text stays chinese even below the 40-character threshold.
    assert.equal(detectMarkdownLanguage('中'.repeat(39)), 'chinese');
});

test('detectMarkdownLanguage falls back to english for empty text', () => {
    assert.equal(detectMarkdownLanguage(''), 'english');
});

test('resolveReferenceLanguage honours an explicit setting', () => {
    assert.equal(resolveReferenceLanguage('中文内容'.repeat(50), 'english'), 'english');
    assert.equal(resolveReferenceLanguage('plain english', 'chinese'), 'chinese');
    assert.equal(resolveReferenceLanguage('中文内容'.repeat(50), 'auto'), 'chinese');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../out/document.js'`

- [ ] **Step 3: 创建 `src/document.ts`**

```ts
const ATX_HEADING_REGEX = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m;
const FENCED_CODE_BLOCK_REGEX = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function extractDocumentTitle(markdownText: string): string | undefined {
    const match = ATX_HEADING_REGEX.exec(markdownText.replace(FENCED_CODE_BLOCK_REGEX, ''));
    if (!match) {
        return undefined;
    }

    const title = match[1].trim();
    return title.length > 0 ? title : undefined;
}

export function resolveDocumentTitle(markdownText: string, configuredTitle: string, markdownPath: string): string {
    const configured = configuredTitle.trim();
    if (configured) {
        return configured;
    }

    const fromHeading = extractDocumentTitle(markdownText);
    if (fromHeading) {
        return fromHeading;
    }

    const fileName = markdownPath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    return sanitizeFileName(fileName);
}

export function sanitizeFileName(name: string): string {
    const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, '_').trim();
    return cleaned.length > 0 ? cleaned : 'document';
}
```

- [ ] **Step 3b: 注意 CJK 正则的字面量陷阱（下面 Step 4 会用到）**

正文字符区间必须写成**字节精确的转义序列**，不要直接把字符本身抄进源码：

```ts
const CJK_CHAR_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
```

如果直接写字符区间，最后一段会被抄成 `U+8C48`（豈）而不是 `U+F900`（CJK 兼容汉字），区间就会把谚文音节（U+AC00–U+D7AF）和彝文音节一起吞进去，韩文文档会被误判为中文。Write 工具会把 `\uXXXX` 序列解释成真实字符，所以落盘后要确认文件里没有裸的控制字节。

- [ ] **Step 4: 创建 `src/language.ts`**

```ts
export type ReferenceLanguage = 'english' | 'chinese';
export type ReferenceLanguageSetting = ReferenceLanguage | 'auto';

const CJK_CHAR_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const LATIN_CHAR_REGEX = /[A-Za-z]/g;

export function normalizeReferenceLanguage(value: string | undefined): ReferenceLanguage {
    return value === 'chinese' ? 'chinese' : 'english';
}

export function normalizeReferenceLanguageSetting(value: string | undefined): ReferenceLanguageSetting {
    if (value === 'auto') {
        return 'auto';
    }

    return normalizeReferenceLanguage(value);
}

export function resolveReferenceLanguage(markdownText: string, setting: ReferenceLanguageSetting): ReferenceLanguage {
    if (setting === 'english' || setting === 'chinese') {
        return setting;
    }

    return detectMarkdownLanguage(markdownText);
}

export function detectMarkdownLanguage(markdownText: string): ReferenceLanguage {
    const sample = markdownText.slice(0, 20000);
    const chineseMatches = sample.match(CJK_CHAR_REGEX)?.length ?? 0;
    const latinMatches = sample.match(LATIN_CHAR_REGEX)?.length ?? 0;

    // Prefer the Chinese template when Chinese text is materially present.
    if (chineseMatches >= 40 || chineseMatches > latinMatches * 0.15) {
        return 'chinese';
    }

    return 'english';
}
```

- [ ] **Step 5: 从 extension.ts 删除被搬走的代码并改为 import**

在 `src/extension.ts` 顶部 import 段加入：

```ts
import { normalizeReferenceLanguage, normalizeReferenceLanguageSetting, resolveReferenceLanguage } from './language';
import type { ReferenceLanguage, ReferenceLanguageSetting } from './language';
import { resolveDocumentTitle } from './document';
```

删除以下函数（它们已搬到新模块）：
`normalizeReferenceLanguage`（原 396 行）、`normalizeReferenceLanguageSetting`（原 400 行）、`resolveReferenceLanguage`（原 408 行）、`detectMarkdownLanguage`（原 416 行）。

同时删除原有的这行类型声明：

```ts
type ReferenceLanguage = 'english' | 'chinese';
type ReferenceLanguageSetting = ReferenceLanguage | 'auto';
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npm test`
Expected: PASS — `# pass 9`（document 7 条 + language 5 条 + smoke 1 条，实际数以输出为准）

- [ ] **Step 7: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 8: 提交**

```bash
git add src/document.ts src/language.ts src/extension.ts test/unit/document.test.js test/unit/language.test.js
git commit -m "refactor: extract document title and language detection into pure modules"
```

---

### Task 3: `src/profiles.ts` —— 预设单一数据源 + 中西文分槽

> **执行说明：Task 3 与 Task 4 合并为一次实现。** 原计划里 Task 3 删掉旧的两张表、Task 4 才改写消费方，中间会留下一个编译不过的破损状态。合并后一次完成「建模块 + 改消费方」，产出可编译、可提交、可评审的完整状态。

**Files:**
- Create: `src/profiles.ts`
- Create: `src/templates.ts`
- Modify: `src/extension.ts`
- Test: `test/unit/profiles.test.js`

- [ ] **Step 1: 写失败的测试**

`test/unit/profiles.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILE_PRESETS, TEMPLATE_LAYOUT, normalizeStyleProfile, STYLE_PROFILES } = require('../../out/profiles.js');

test('all six profiles exist', () => {
    assert.deepEqual([...STYLE_PROFILES].sort(), ['academic', 'business', 'official', 'technical', 'template', 'thesis']);
});

test('normalizeStyleProfile falls back to template', () => {
    assert.equal(normalizeStyleProfile('academic'), 'academic');
    assert.equal(normalizeStyleProfile('nonsense'), 'template');
    assert.equal(normalizeStyleProfile(undefined), 'template');
});

test('official profile uses GB/T 9704 margins', () => {
    const official = PROFILE_PRESETS.official;
    assert.equal(official.marginTopMm, 37);
    assert.equal(official.marginBottomMm, 35);
    assert.equal(official.marginLeftMm, 28);
    assert.equal(official.marginRightMm, 26);
});

test('thesis profile uses GB/T 7713 heading sizes', () => {
    const thesis = PROFILE_PRESETS.thesis;
    assert.equal(thesis.heading1SizePt, 22);
    assert.equal(thesis.heading2SizePt, 16);
    assert.equal(thesis.heading3SizePt, 14);
    assert.equal(thesis.marginTopMm, 30);
});

test('official profile maps heading fonts to GB/T 9704 levels', () => {
    const official = PROFILE_PRESETS.official;
    assert.equal(official.heading1.eastAsia, 'SimHei');
    assert.equal(official.heading2.eastAsia, 'KaiTi');
    assert.equal(official.heading3.eastAsia, 'FangSong');
});

test('body fonts split latin and east-asian slots', () => {
    assert.equal(PROFILE_PRESETS.academic.body.ascii, 'Times New Roman');
    assert.equal(PROFILE_PRESETS.academic.body.eastAsia, 'SimSun');
    assert.equal(PROFILE_PRESETS.business.body.ascii, 'Arial');
    assert.equal(PROFILE_PRESETS.business.body.eastAsia, 'Microsoft YaHei');
    assert.equal(PROFILE_PRESETS.official.body.eastAsia, 'FangSong');
});

test('no preset stores pandoc metadata twice', () => {
    for (const [name, preset] of Object.entries(PROFILE_PRESETS)) {
        assert.equal(preset.metadata, undefined, `${name} must not carry a metadata field`);
    }
});

test('official pins an exact line height and no multiplier', () => {
    assert.equal(PROFILE_PRESETS.official.lineSpacing, undefined);
    assert.equal(PROFILE_PRESETS.official.lineSpacingTwips, 580);
    assert.equal(PROFILE_PRESETS.official.lineSpacingRule, 'exact');
});

test('business and technical line spacing matches the Dify plugin', () => {
    assert.equal(PROFILE_PRESETS.business.lineSpacing, 1.5);
    assert.equal(PROFILE_PRESETS.technical.lineSpacing, 1.35);
});

test('official uses an exact 29pt line height', () => {
    assert.equal(PROFILE_PRESETS.official.lineSpacingTwips, 580);
    assert.equal(PROFILE_PRESETS.official.lineSpacingRule, 'exact');
});

test('template layout covers every profile', () => {
    for (const name of STYLE_PROFILES) {
        assert.ok(TEMPLATE_LAYOUT[name], `missing layout for ${name}`);
        assert.ok(TEMPLATE_LAYOUT[name].indentTwips.chinese >= 0);
        assert.ok(TEMPLATE_LAYOUT[name].indentTwips.english >= 0);
    }
});

test('the template profile carries no font or size defaults', () => {
    const template = PROFILE_PRESETS.template;
    assert.equal(template.body, undefined);
    assert.equal(template.bodySizePt, undefined);
    assert.equal(template.heading1, undefined);
    assert.deepEqual(template, {});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../out/profiles.js'`

- [ ] **Step 3: 创建 `src/profiles.ts`**

```ts
export type StyleProfile = 'template' | 'academic' | 'business' | 'technical' | 'official' | 'thesis';

export const STYLE_PROFILES: readonly StyleProfile[] = ['template', 'academic', 'business', 'technical', 'official', 'thesis'];

export interface FontPair {
    /** Latin / western font — maps to w:ascii, w:hAnsi, w:cs. */
    ascii: string;
    /** East-asian font — maps to w:eastAsia. */
    eastAsia: string;
}

/** Code-block styling, present only when the profile styles code blocks. */
export interface CodeStyle {
    font: string;
    sizePt: number;
    /** Multiple, not twips. */
    lineSpacing: number;
    shadingFill: string;
}

export interface ProfilePreset {
    body?: FontPair;
    bodySizePt?: number;
    heading1?: FontPair;
    heading1SizePt?: number;
    heading2?: FontPair;
    heading2SizePt?: number;
    heading3?: FontPair;
    heading3SizePt?: number;
    /** Monospace font, feeds pandoc `monofont`. */
    monoFont?: string;
    /** Text colour applied to body and heading styles. */
    color?: string;
    /** Code style — absent means the profile does not touch code blocks. */
    codeStyle?: CodeStyle;
    /** Line spacing multiplier — feeds pandoc `linestretch`. */
    lineSpacing?: number;
    /** Fixed line height in twips; wins over the multiplier for the DOCX layer. */
    lineSpacingTwips?: number;
    /** The line rule that goes with the spacing value. */
    lineSpacingRule?: 'auto' | 'exact';
    marginTopMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
}

export type HeadingAlignment = 'left' | 'center';

export interface ProfileLayout {
    justification: 'both' | 'left';
    indentTwips: { chinese: number; english: number };
    headingAlign: [HeadingAlignment, HeadingAlignment, HeadingAlignment];
    headingBeforeTwips: [number, number, number];
    headingAfterTwips: [number, number, number];
}

export const PROFILE_PRESETS: Record<StyleProfile, ProfilePreset> = {
    template: {},
    academic: {
        body: { ascii: 'Times New Roman', eastAsia: 'SimSun' },
        bodySizePt: 12,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading3SizePt: 12,
        color: '000000',
        lineSpacing: 1.5,
        marginTopMm: 25.4,
        marginBottomMm: 25.4,
        marginLeftMm: 31.75,
        marginRightMm: 31.75
    },
    business: {
        body: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        bodySizePt: 11,
        heading1: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading1SizePt: 18,
        heading2: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading3SizePt: 12,
        color: '000000',
        lineSpacing: 1.5,
        marginTopMm: 25.4,
        marginBottomMm: 25.4,
        marginLeftMm: 25.4,
        marginRightMm: 25.4
    },
    technical: {
        body: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        bodySizePt: 11,
        heading1: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading2SizePt: 14,
        heading3: { ascii: 'Arial', eastAsia: 'Microsoft YaHei' },
        heading3SizePt: 12,
        monoFont: 'Consolas',
        color: '000000',
        codeStyle: { font: 'Consolas', sizePt: 10, lineSpacing: 1.05, shadingFill: 'F3F4F6' },
        lineSpacing: 1.35,
        marginTopMm: 19,
        marginBottomMm: 19,
        marginLeftMm: 19,
        marginRightMm: 19
    },
    official: {
        body: { ascii: 'Times New Roman', eastAsia: 'FangSong' },
        bodySizePt: 16,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 16,
        heading2: { ascii: 'Times New Roman', eastAsia: 'KaiTi' },
        heading2SizePt: 16,
        heading3: { ascii: 'Times New Roman', eastAsia: 'FangSong' },
        heading3SizePt: 16,
        color: '000000',
        lineSpacingTwips: 580,
        lineSpacingRule: 'exact',
        marginTopMm: 37,
        marginBottomMm: 35,
        marginLeftMm: 28,
        marginRightMm: 26
    },
    thesis: {
        body: { ascii: 'Times New Roman', eastAsia: 'SimSun' },
        bodySizePt: 12,
        heading1: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading1SizePt: 22,
        heading2: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading2SizePt: 16,
        heading3: { ascii: 'Times New Roman', eastAsia: 'SimHei' },
        heading3SizePt: 14,
        color: '000000',
        lineSpacing: 1.5,
        marginTopMm: 30,
        marginBottomMm: 30,
        marginLeftMm: 30,
        marginRightMm: 30
    }
};

/** Build-time layout parameters. Only the template generator consumes these. */
export const TEMPLATE_LAYOUT: Partial<Record<StyleProfile, ProfileLayout>> = {
    academic: {
        justification: 'both',
        indentTwips: { chinese: 480, english: 0 },
        headingAlign: ['left', 'left', 'left'],
        headingBeforeTwips: [240, 200, 160],
        headingAfterTwips: [120, 100, 80]
    },
    business: {
        justification: 'both',
        indentTwips: { chinese: 440, english: 0 },
        headingAlign: ['left', 'left', 'left'],
        headingBeforeTwips: [280, 220, 180],
        headingAfterTwips: [140, 110, 90]
    },
    technical: {
        justification: 'left',
        indentTwips: { chinese: 440, english: 0 },
        headingAlign: ['left', 'left', 'left'],
        headingBeforeTwips: [200, 160, 140],
        headingAfterTwips: [100, 80, 80]
    },
    official: {
        justification: 'both',
        indentTwips: { chinese: 640, english: 0 },
        headingAlign: ['center', 'left', 'left'],
        headingBeforeTwips: [240, 120, 120],
        headingAfterTwips: [120, 60, 60]
    },
    thesis: {
        justification: 'both',
        indentTwips: { chinese: 480, english: 0 },
        headingAlign: ['center', 'left', 'left'],
        headingBeforeTwips: [360, 240, 200],
        headingAfterTwips: [180, 120, 100]
    }
};

export function normalizeStyleProfile(value: string | undefined): StyleProfile {
    const normalized = value?.trim().toLowerCase();
    return STYLE_PROFILES.includes(normalized as StyleProfile) ? (normalized as StyleProfile) : 'template';
}

/** Explicit user font wins and fills both slots; otherwise fall back to the preset pair. */
export function resolveFontPair(explicitFont: string | undefined, presetPair?: FontPair): FontPair | undefined {
    const explicit = explicitFont?.trim();
    if (explicit) {
        return { ascii: explicit, eastAsia: explicit };
    }

    return presetPair;
}

export function resolveLineSpacingTwips(
    profile: StyleProfile,
    userLineSpacing?: number
): { twips: number; rule: 'auto' | 'exact' } | undefined {
    if (userLineSpacing) {
        return { twips: Math.round(userLineSpacing * 240), rule: 'auto' };
    }

    const preset = PROFILE_PRESETS[profile];
    if (preset.lineSpacingTwips) {
        return { twips: preset.lineSpacingTwips, rule: preset.lineSpacingRule ?? 'exact' };
    }

    if (preset.lineSpacing) {
        return { twips: Math.round(preset.lineSpacing * 240), rule: 'auto' };
    }

    return undefined;
}

/** Pandoc metadata, derived from the typed preset fields — never stored twice. */
export function buildPandocMetadata(options: {
    profile: StyleProfile;
    bodyFont?: string;
    bodySizePt?: number;
    lineSpacing?: number;
}): Record<string, string> {
    const preset = PROFILE_PRESETS[options.profile];
    const metadata: Record<string, string> = {};

    const bodyFont = resolveFontPair(options.bodyFont, preset.body);
    if (bodyFont) {
        metadata.mainfont = bodyFont.ascii;
        metadata.CJKmainfont = bodyFont.eastAsia;
    }

    const bodySize = options.bodySizePt ?? preset.bodySizePt;
    if (bodySize) {
        metadata.fontsize = `${bodySize}pt`;
    }

    const lineSpacing = options.lineSpacing ?? preset.lineSpacing;
    if (lineSpacing) {
        metadata.linestretch = String(lineSpacing);
    }

    if (preset.monoFont) {
        metadata.monofont = preset.monoFont;
    }

    return metadata;
}

export function resolveMarginsMm(
    profile: StyleProfile,
    overrides: { top?: number; bottom?: number; left?: number; right?: number }
): { top?: number; bottom?: number; left?: number; right?: number } {
    const preset = PROFILE_PRESETS[profile];
    return {
        top: overrides.top ?? preset.marginTopMm,
        bottom: overrides.bottom ?? preset.marginBottomMm,
        left: overrides.left ?? preset.marginLeftMm,
        right: overrides.right ?? preset.marginRightMm
    };
}
```

**注意**：`official` 预设**没有** `lineSpacing` 倍数 —— 它只有 `lineSpacingTwips: 580` + `lineSpacingRule: 'exact'`。GB/T 9704 要求固定值 29 磅行距，倍数（1.75）在 DOCX 层会被覆盖掉，留着只会造成「哪个值权威」的困惑。pandoc 层因此拿不到 `linestretch`，但 DOCX 层总会写 580，最终产物一致。

`template` 预设是空对象 —— 它不施加任何覆盖是**结果**而不是特判。

- [ ] **Step 4: 从 extension.ts 删掉旧的两张表并改为 import**

删除 `src/extension.ts` 里的：

```ts
const BUNDLED_REFERENCE_DOCX_BY_PROFILE_AND_LANGUAGE: Record<StyleProfile, Record<ReferenceLanguage, string>> = { ... };
const STYLE_PROFILE_METADATA: Record<StyleProfile, Record<string, string>> = { ... };
type StyleProfile = 'template' | 'academic' | 'business' | 'technical';
```

以及整个 `getProfileDocxDefaults()` 函数。

import 段加入：

```ts
import { PROFILE_PRESETS, normalizeStyleProfile } from './profiles';
import type { FontPair, ProfilePreset, StyleProfile } from './profiles';
```

注意 `tsconfig.json` 已启用 `noUnusedLocals: true` —— 有未使用的 import 会直接编译失败。如果某个 import 在本任务里用不上，就不要加它。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS — profiles 测试全绿

- [ ] **Step 6: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误（Task 4 的改动已包含在本任务内）

- [ ] **Step 7: 提交**

```bash
git add src/profiles.ts src/templates.ts src/extension.ts test/unit/profiles.test.js
git commit -m "feat: consolidate style presets into a single source of truth"
```

---

### Task 4: `src/templates.ts` + extension.ts 改用新预设（含双字体字段）

> 本任务已合并进 Task 3 执行。下面这段是合并前的原始描述，**已被 Task 3 的新版 `src/profiles.ts` 取代** —— 预设表现在没有 `metadata` 字段，pandoc metadata 改为从类型化字段推导，`resolveFontPair` / `resolveLineSpacingTwips` / `resolveMarginsMm` 也已经移进纯模块 `src/profiles.ts`。以 Task 3 的版本为准。

**Files:**
- Create: `src/templates.ts`
- Modify: `src/extension.ts`
- Test: `test/unit/profiles.test.js`（追加）

- [ ] **Step 1: 追加失败的测试**

在 `test/unit/profiles.test.js` 末尾追加：

```js
const { BUNDLED_REFERENCE_DOCX, getBundledReferenceDocxCandidates } = require('../../out/templates.js');

test('every profile maps to a bundled template for both languages', () => {
    for (const name of STYLE_PROFILES) {
        assert.ok(BUNDLED_REFERENCE_DOCX[name].english, `missing english template for ${name}`);
        assert.ok(BUNDLED_REFERENCE_DOCX[name].chinese, `missing chinese template for ${name}`);
    }
});

test('thesis has its own template rather than reusing academic', () => {
    assert.match(BUNDLED_REFERENCE_DOCX.thesis.english, /reference_english_thesis\.docx$/);
    assert.match(BUNDLED_REFERENCE_DOCX.thesis.chinese, /reference_chinese_thesis\.docx$/);
});

test('bundled candidates are absolute paths under multi-templates', () => {
    const candidates = getBundledReferenceDocxCandidates('/ext', 'chinese', 'official');
    assert.equal(candidates.length, 1);
    assert.match(candidates[0], /multi-templates[\\/]reference_chinese_official\.docx$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../out/templates.js'`

- [ ] **Step 3: 创建 `src/templates.ts`**

```ts
import * as path from 'path';
import type { ReferenceLanguage } from './language';
import type { StyleProfile } from './profiles';

export const BUNDLED_REFERENCE_DOCX: Record<StyleProfile, Record<ReferenceLanguage, string>> = {
    template: {
        english: path.join('multi-templates', 'reference_english_academic.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_academic.docx')
    },
    academic: {
        english: path.join('multi-templates', 'reference_english_academic.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_academic.docx')
    },
    business: {
        english: path.join('multi-templates', 'reference_english_business.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_business.docx')
    },
    technical: {
        english: path.join('multi-templates', 'reference_english_technical.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_technical.docx')
    },
    official: {
        english: path.join('multi-templates', 'reference_english_official.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_official.docx')
    },
    thesis: {
        english: path.join('multi-templates', 'reference_english_thesis.docx'),
        chinese: path.join('multi-templates', 'reference_chinese_thesis.docx')
    }
};

export function getBundledReferenceDocxCandidates(
    extensionPath: string,
    referenceLanguage: ReferenceLanguage,
    styleProfile: StyleProfile
): string[] {
    const primary = BUNDLED_REFERENCE_DOCX[styleProfile][referenceLanguage];
    return [path.join(extensionPath, primary)];
}
```

- [ ] **Step 4: 改写 extension.ts 的样式覆盖层**

先删除 extension.ts 里原有的 `getBundledReferenceDocxCandidates()` 函数，并在 import 段加入：

```ts
import { getBundledReferenceDocxCandidates } from './templates';
```

然后把 `DocxStyleOverride` 接口与相关函数改为：

```ts
interface DocxStyleOverride {
    styleId: string;
    aliases?: string[];
    asciiFont?: string;
    eastAsiaFont?: string;
    sizePt?: number;
    lineSpacingTwips?: number;
    lineSpacingRule?: 'auto' | 'exact';
    color?: string;
    shadingFill?: string;
}
```

`updateStyleXml` 中字体与行距部分改为：

```ts
    if (override.asciiFont || override.eastAsiaFont) {
        const ascii = override.asciiFont ?? override.eastAsiaFont ?? '';
        const eastAsia = override.eastAsiaFont ?? override.asciiFont ?? '';
        const fontXml = `<w:rFonts w:ascii="${escapeXmlAttribute(ascii)}" w:hAnsi="${escapeXmlAttribute(ascii)}" w:eastAsia="${escapeXmlAttribute(eastAsia)}" w:cs="${escapeXmlAttribute(ascii)}"/>`;
        updated = upsertInsideElement(updated, 'w:rPr', /<w:rFonts\b[^>]*\/>/, fontXml);
    }
```

```ts
    if (override.lineSpacingTwips) {
        const rule = override.lineSpacingRule ?? 'auto';
        updated = upsertInsideElement(updated, 'w:pPr', /<w:spacing\b[^>]*\/>/, `<w:spacing w:line="${override.lineSpacingTwips}" w:lineRule="${rule}"/>`);
    }
```

`buildDocxStyleOverrides` 整体改为：

```ts
function resolveFontPair(explicitFont: string, presetPair?: FontPair): FontPair | undefined {
    const explicit = explicitFont.trim();
    if (explicit) {
        return { ascii: explicit, eastAsia: explicit };
    }

    return presetPair;
}

function resolveLineSpacingTwips(settings: ExportSettings, preset: ProfilePreset): { twips: number; rule: 'auto' | 'exact' } | undefined {
    if (settings.lineSpacing) {
        return { twips: Math.round(settings.lineSpacing * 240), rule: 'auto' };
    }

    if (preset.lineSpacingTwips) {
        return { twips: preset.lineSpacingTwips, rule: preset.lineSpacingRule ?? 'exact' };
    }

    if (preset.lineSpacing) {
        return { twips: Math.round(preset.lineSpacing * 240), rule: 'auto' };
    }

    return undefined;
}

function buildDocxStyleOverrides(settings: ExportSettings): DocxStyleOverride[] {
    const preset = PROFILE_PRESETS[settings.styleProfile];
    const effectiveColor = settings.styleProfile === 'template' ? undefined : '000000';
    const bodyFont = resolveFontPair(settings.bodyFont, preset.body);
    const heading1Font = resolveFontPair(settings.heading1Font, preset.heading1);
    const heading2Font = resolveFontPair(settings.heading2Font, preset.heading2);
    const heading3Font = resolveFontPair(settings.heading3Font, preset.heading3);
    const lineSpacing = resolveLineSpacingTwips(settings, preset);

    const overrides: DocxStyleOverride[] = [
        {
            styleId: 'Normal',
            aliases: ['a', 'a1', 'Text', 'BodyText', 'Body Text', 'FirstParagraph', 'Compact'],
            asciiFont: bodyFont?.ascii,
            eastAsiaFont: bodyFont?.eastAsia,
            sizePt: settings.bodySizePt ?? preset.bodySizePt,
            lineSpacingTwips: lineSpacing?.twips,
            lineSpacingRule: lineSpacing?.rule,
            color: effectiveColor
        },
        {
            styleId: 'Heading1',
            aliases: ['1'],
            asciiFont: heading1Font?.ascii,
            eastAsiaFont: heading1Font?.eastAsia,
            sizePt: settings.heading1SizePt ?? preset.heading1SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading2',
            aliases: ['2', '21'],
            asciiFont: heading2Font?.ascii,
            eastAsiaFont: heading2Font?.eastAsia,
            sizePt: settings.heading2SizePt ?? preset.heading2SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading3',
            aliases: ['3', '31'],
            asciiFont: heading3Font?.ascii,
            eastAsiaFont: heading3Font?.eastAsia,
            sizePt: settings.heading3SizePt ?? preset.heading3SizePt,
            color: effectiveColor
        }
    ];

    if (settings.styleProfile === 'technical') {
        overrides.push(...buildTechnicalCodeStyleOverrides());
    }

    return overrides.filter((override) => hasDocxStyleOverrideValue(override));
}
```

`hasDocxStyleOverrideValue` 改为：

```ts
function hasDocxStyleOverrideValue(override: DocxStyleOverride): boolean {
    return Boolean(
        override.asciiFont
        || override.eastAsiaFont
        || override.sizePt
        || override.lineSpacingTwips
        || override.color
        || override.shadingFill
    );
}
```

`buildTechnicalCodeStyleOverrides` 改为：

```ts
function buildTechnicalCodeStyleOverrides(): DocxStyleOverride[] {
    return [
        {
            styleId: 'SourceCode',
            aliases: ['Code'],
            asciiFont: 'Consolas',
            eastAsiaFont: 'Consolas',
            sizePt: 10,
            lineSpacingTwips: 252,
            lineSpacingRule: 'auto',
            color: '000000',
            shadingFill: 'F3F4F6'
        },
        {
            styleId: 'VerbatimChar',
            asciiFont: 'Consolas',
            eastAsiaFont: 'Consolas',
            sizePt: 10,
            color: '000000'
        }
    ];
}
```

`buildPandocMetadata` 改为：

```ts
function buildPandocMetadata(settings: ExportSettings): Record<string, string> {
    const preset = PROFILE_PRESETS[settings.styleProfile];
    const metadata: Record<string, string> = { ...preset.metadata };

    if (settings.bodyFont) {
        metadata.mainfont = settings.bodyFont;
        metadata.CJKmainfont = settings.bodyFont;
    }

    if (settings.bodySizePt) {
        metadata.fontsize = `${settings.bodySizePt}pt`;
    }

    if (settings.lineSpacing) {
        metadata.linestretch = String(settings.lineSpacing);
    }

    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value.trim().length > 0));
}
```

- [ ] **Step 5: 页边距默认值接入**

`hasMarginOverrides` 与 `updateDocumentMargins` 改为读预设默认值：

```ts
function resolveMarginMm(settings: ExportSettings, preset: ProfilePreset) {
    return {
        top: settings.marginTopMm ?? preset.marginTopMm,
        bottom: settings.marginBottomMm ?? preset.marginBottomMm,
        left: settings.marginLeftMm ?? preset.marginLeftMm,
        right: settings.marginRightMm ?? preset.marginRightMm
    };
}

function hasMarginOverrides(settings: ExportSettings): boolean {
    const margins = resolveMarginMm(settings, PROFILE_PRESETS[settings.styleProfile]);
    return Boolean(margins.top || margins.bottom || margins.left || margins.right);
}

function updateDocumentMargins(documentXml: string, settings: ExportSettings): string {
    const margins = resolveMarginMm(settings, PROFILE_PRESETS[settings.styleProfile]);
    return documentXml.replace(/<w:pgMar\b[^>]*\/>/g, (pgMarXml) => {
        const marginUpdates = [
            { attr: 'w:top', value: margins.top },
            { attr: 'w:bottom', value: margins.bottom },
            { attr: 'w:left', value: margins.left },
            { attr: 'w:right', value: margins.right }
        ];

        let updated = pgMarXml;
        for (const margin of marginUpdates) {
            if (margin.value) {
                updated = upsertXmlAttribute(updated, margin.attr, String(mmToTwips(margin.value)));
            }
        }

        return updated;
    });
}
```

- [ ] **Step 6: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 7: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add src/profiles.ts src/templates.ts src/extension.ts test/unit/profiles.test.js
git commit -m "feat: consolidate style presets into a single source of truth

Profiles now carry a metadata table and a DOCX defaults table together,
so the pandoc layer and the XML layer can no longer drift. Fonts are
split into ascii/eastAsia slots so English documents stop rendering
their body text in SimSun. Adds official (GB/T 9704) and thesis
(GB/T 7713) profiles with their own page margins."
```

---

### Task 5: 模板生成器与 10 个模板

**Files:**
- Create: `scripts/reference-base.docx`（从 pandoc 官方 reference.docx 复制）
- Create: `scripts/build-templates.js`
- Modify: `multi-templates/`（重新生成 10 个）
- Modify: `.vscodeignore`（模板白名单 + 排除 test/）
- Modify: `test/unit/profiles.test.js`（解除存在性测试的 skip）
- Test: `test/unit/templates.test.js`

**背景：** 现有 6 个模板是二进制 .docx，样式规则不可见、不可审阅、不可复现；三个英文模板还带着从期刊模板继承来的双栏、smallCaps、自动编号、斜体标题。本次改为**生成器 + 声明式样式表**，以 pandoc 官方 reference.docx 为基底生成全部 10 个模板（5 预设 × 中英）。

生成器读取 `out/profiles.js` 的 `PROFILE_PRESETS` 与 `TEMPLATE_LAYOUT` —— 与运行时扩展读的是同一张表，所以模板和预设永远不会对不上。

- [ ] **Step 1: 准备基底文件**

```bash
pandoc --print-default-data-file reference.docx > scripts/reference-base.docx
```

基底文件提交进仓库，保证重新生成是确定性的（不受本机 pandoc 版本影响）。它提供 OOXML 骨架（content types、rels、fontTable、numbering、settings、theme），生成器只负责改写样式与页面设置。

Verify: `ls -la scripts/reference-base.docx` → 应约 40–60 KB。

- [ ] **Step 2: 写失败的测试**

`test/unit/templates.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'multi-templates');
const { PROFILE_PRESETS, TEMPLATE_LAYOUT } = require('../../out/profiles.js');

const GENERATED_PROFILES = ['academic', 'business', 'technical', 'official', 'thesis'];

function readTemplate(profile, language) {
    const file = path.join(TEMPLATE_DIR, `reference_${language}_${profile}.docx`);
    assert.ok(fs.existsSync(file), `missing template ${path.basename(file)}`);
    return new AdmZip(file);
}

test('all ten templates exist', () => {
    for (const profile of GENERATED_PROFILES) {
        for (const language of ['english', 'chinese']) {
            assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, `reference_${language}_${profile}.docx`)));
        }
    }
});

for (const profile of GENERATED_PROFILES) {
    for (const language of ['english', 'chinese']) {
        test(`${profile}/${language} is single column A4`, () => {
            const zip = readTemplate(profile, language);
            const document = zip.readAsText('word/document.xml');
            const sectPr = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)[0];
            assert.ok(!/w:num="2"/.test(sectPr), 'must not be two columns');
            assert.match(sectPr, /<w:pgSz w:w="11906" w:h="16838"\s*\/>/);
        });

        test(`${profile}/${language} carries the preset page margins`, () => {
            const zip = readTemplate(profile, language);
            const document = zip.readAsText('word/document.xml');
            const sectPr = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)[0];
            const pgMar = sectPr.match(/<w:pgMar\b[^>]*\/>/)[0];
            const preset = PROFILE_PRESETS[profile];
            const toTwips = (mm) => Math.round((mm * 1440) / 25.4);
            assert.match(pgMar, new RegExp(`w:top="${toTwips(preset.marginTopMm)}"`));
            assert.match(pgMar, new RegExp(`w:bottom="${toTwips(preset.marginBottomMm)}"`));
            assert.match(pgMar, new RegExp(`w:left="${toTwips(preset.marginLeftMm)}"`));
            assert.match(pgMar, new RegExp(`w:right="${toTwips(preset.marginRightMm)}"`));
        });

        test(`${profile}/${language} defines Normal as the default paragraph style`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            assert.ok(normal.includes('w:default="1"'), 'Normal must be the default style');
            assert.match(normal, /<w:rFonts[^>]*w:ascii="[^"]+"[^>]*w:eastAsia="[^"]+"/);
        });

        test(`${profile}/${language} splits latin and east-asian fonts`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            const preset = PROFILE_PRESETS[profile];
            assert.match(normal, new RegExp(`w:ascii="${preset.body.ascii}"`));
            assert.match(normal, new RegExp(`w:eastAsia="${preset.body.eastAsia}"`));
        });

        test(`${profile}/${language} uses the preset body size`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            const preset = PROFILE_PRESETS[profile];
            assert.match(normal, new RegExp(`<w:sz w:val="${preset.bodySizePt * 2}"/>`));
        });

        test(`${profile}/${language} defines canonical pandoc style ids`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            for (const id of ['BodyText', 'FirstParagraph', 'Compact', 'Heading1', 'Heading2', 'Heading3', 'SourceCode', 'VerbatimChar']) {
                assert.ok(styles.includes(`w:styleId="${id}"`), `missing style ${id}`);
            }
        });

        test(`${profile}/${language} applies the preset line spacing rule`, () => {
            const zip = readTemplate(profile, language);
            const styles = zip.readAsText('word/styles.xml');
            const normal = styles.match(/<w:style\b[^>]*w:styleId="Normal"[^>]*>[\s\S]*?<\/w:style>/)[0];
            const preset = PROFILE_PRESETS[profile];
            const expectedTwips = preset.lineSpacingTwips ?? Math.round(preset.lineSpacing * 240);
            const expectedRule = preset.lineSpacingTwips ? 'exact' : 'auto';
            assert.match(normal, new RegExp(`w:line="${expectedTwips}"`));
            assert.match(normal, new RegExp(`w:lineRule="${expectedRule}"`));
        });
    }
}

test('chinese templates indent the first line, english templates do not', () => {
    const chinese = new AdmZip(path.join(TEMPLATE_DIR, 'reference_chinese_academic.docx')).readAsText('word/styles.xml');
    const english = new AdmZip(path.join(TEMPLATE_DIR, 'reference_english_academic.docx')).readAsText('word/styles.xml');
    const indent = TEMPLATE_LAYOUT.academic.indentTwips;
    assert.match(chinese, new RegExp(`<w:ind w:firstLine="${indent.chinese}"\\s*/>`));
    assert.ok(!new RegExp(`<w:ind w:firstLine="${indent.chinese}"\\s*/>`).test(english));
});

test('templates carry a page-number footer', () => {
    const zip = readTemplate('academic', 'chinese');
    assert.ok(zip.getEntry('word/footer1.xml'), 'footer part missing');
    assert.match(zip.readAsText('word/footer1.xml'), /PAGE/);
});

test('the footer is wired into the section properties', () => {
    const zip = readTemplate('academic', 'chinese');
    const document = zip.readAsText('word/document.xml');
    assert.match(document, /<w:footerReference w:type="default" r:id="[^"]+"\/>/);
    assert.match(zip.readAsText('word/_rels/document.xml.rels'), /footer1\.xml/);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `missing template reference_english_official.docx`

- [ ] **Step 4: 创建 `scripts/build-templates.js`**

```js
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { PROFILE_PRESETS, TEMPLATE_LAYOUT } = require('../out/profiles.js');

const REPO_ROOT = path.join(__dirname, '..');
const BASE_DOCX = path.join(__dirname, 'reference-base.docx');
const OUTPUT_DIR = path.join(REPO_ROOT, 'multi-templates');

const A4_WIDTH_TWIPS = 11906;
const A4_HEIGHT_TWIPS = 16838;
const HEADER_TWIPS = 850;
const FOOTER_TWIPS = 990;
const FOOTER_REL_ID = 'rId900';
const PAGE_NUMBER_FONT = 'SimSun';
const PAGE_NUMBER_SIZE_PT = 14;

const PROFILE_ORDER = ['academic', 'business', 'technical', 'official', 'thesis'];
const LANGUAGE_ORDER = ['english', 'chinese'];

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function mmToTwips(mm) {
    return Math.round((mm * 1440) / 25.4);
}

function fontXml(ascii, eastAsia) {
    return `<w:rFonts w:ascii="${escapeXml(ascii)}" w:hAnsi="${escapeXml(ascii)}" w:eastAsia="${escapeXml(eastAsia)}" w:cs="${escapeXml(ascii)}"/>`;
}

function sizeXml(sizePt) {
    const halfPoints = Math.round(sizePt * 2);
    return `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
}

function paragraphStyle({ id, name, basedOn = 'Normal', pPr = '', rPr = '', custom = true }) {
    const customAttr = custom ? ' w:customStyle="1"' : '';
    return `<w:style w:type="paragraph"${customAttr} w:styleId="${escapeXml(id)}">`
        + `<w:name w:val="${escapeXml(name)}"/>`
        + `<w:basedOn w:val="${escapeXml(basedOn)}"/>`
        + `<w:qFormat/>`
        + (pPr ? `<w:pPr>${pPr}</w:pPr>` : '')
        + (rPr ? `<w:rPr>${rPr}</w:rPr>` : '')
        + `</w:style>`;
}

function buildStyles(profile, language) {
    const preset = PROFILE_PRESETS[profile];
    const layout = TEMPLATE_LAYOUT[profile];
    if (!layout) {
        throw new Error(`No template layout for profile "${profile}"`);
    }

    const indent = layout.indentTwips[language];
    const lineTwips = preset.lineSpacingTwips ?? Math.round((preset.lineSpacing ?? 1.5) * 240);
    const lineRule = preset.lineSpacingTwips ? 'exact' : 'auto';

    const bodyPPr = '<w:widowControl/>'
        + `<w:spacing w:after="0" w:line="${lineTwips}" w:lineRule="${lineRule}"/>`
        + (indent ? `<w:ind w:firstLine="${indent}"/>` : '')
        + `<w:jc w:val="${layout.justification}"/>`;
    const bodyRPr = fontXml(preset.body.ascii, preset.body.eastAsia) + sizeXml(preset.bodySizePt);

    const definitions = [];

    definitions.push(
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
        + '<w:name w:val="Normal"/><w:qFormat/>'
        + `<w:pPr>${bodyPPr}</w:pPr>`
        + `<w:rPr>${bodyRPr}</w:rPr>`
        + '</w:style>'
    );

    for (const [id, name] of [['BodyText', 'Body Text'], ['FirstParagraph', 'First Paragraph'], ['Compact', 'Compact']]) {
        definitions.push(paragraphStyle({ id, name, pPr: bodyPPr, rPr: bodyRPr }));
    }

    const headings = [
        { font: preset.heading1, sizePt: preset.heading1SizePt },
        { font: preset.heading2, sizePt: preset.heading2SizePt },
        { font: preset.heading3, sizePt: preset.heading3SizePt }
    ];

    headings.forEach((heading, index) => {
        const id = `Heading${index + 1}`;
        definitions.push(paragraphStyle({
            id,
            name: `heading ${index + 1}`,
            basedOn: 'Normal',
            custom: false,
            pPr: '<w:keepNext/><w:keepLines/>'
                + `<w:spacing w:before="${layout.headingBeforeTwips[index]}" w:after="${layout.headingAfterTwips[index]}" w:line="${lineTwips}" w:lineRule="${lineRule}"/>`
                + '<w:ind w:firstLine="0"/>'
                + `<w:jc w:val="${layout.headingAlign[index]}"/>`
                + `<w:outlineLvl w:val="${index}"/>`,
            rPr: fontXml(heading.font.ascii, heading.font.eastAsia) + sizeXml(heading.sizePt) + '<w:b/><w:bCs/>'
        }));
    });

    const codeStyle = preset.codeStyle;
    if (codeStyle) {
        definitions.push(paragraphStyle({
            id: 'SourceCode',
            name: 'Source Code',
            pPr: '<w:wordWrap w:val="off"/>'
                + `<w:spacing w:before="60" w:after="60" w:line="${Math.round(codeStyle.lineSpacing * 240)}" w:lineRule="auto"/>`
                + '<w:ind w:left="280" w:right="280" w:firstLine="0"/>'
                + '<w:jc w:val="left"/>'
                + `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXml(codeStyle.shadingFill)}"/>`,
            rPr: fontXml(codeStyle.font, codeStyle.font) + sizeXml(codeStyle.sizePt)
        }));

        definitions.push(
            '<w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar">'
            + '<w:name w:val="Verbatim Char"/>'
            + `<w:rPr>${fontXml(codeStyle.font, codeStyle.font)}${sizeXml(codeStyle.sizePt)}</w:rPr>`
            + '</w:style>'
        );
    } else {
        definitions.push(paragraphStyle({
            id: 'SourceCode',
            name: 'Source Code',
            pPr: '<w:wordWrap w:val="off"/>'
                + '<w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/>'
                + '<w:ind w:left="280" w:right="280" w:firstLine="0"/>'
                + '<w:jc w:val="left"/>',
            rPr: fontXml('Consolas', 'Consolas') + sizeXml(9)
        }));

        definitions.push(
            '<w:style w:type="character" w:customStyle="1" w:styleId="VerbatimChar">'
            + '<w:name w:val="Verbatim Char"/>'
            + `<w:rPr>${fontXml('Consolas', 'Consolas')}${sizeXml(9)}</w:rPr>`
            + '</w:style>'
        );
    }

    return definitions.join('');
}

function buildDocument(profile) {
    const preset = PROFILE_PRESETS[profile];
    return (
        `<w:footerReference w:type="default" r:id="${FOOTER_REL_ID}"/>`
        + '<w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>'
        + `<w:pgSz w:w="${A4_WIDTH_TWIPS}" w:h="${A4_HEIGHT_TWIPS}"/>`
        + '<w:pgMar'
        + ` w:top="${mmToTwips(preset.marginTopMm)}"`
        + ` w:right="${mmToTwips(preset.marginRightMm)}"`
        + ` w:bottom="${mmToTwips(preset.marginBottomMm)}"`
        + ` w:left="${mmToTwips(preset.marginLeftMm)}"`
        + ` w:header="${HEADER_TWIPS}" w:footer="${FOOTER_TWIPS}" w:gutter="0"/>`
        + '<w:cols w:space="720"/>'
        + '<w:docGrid w:linePitch="312"/>'
    );
}

function buildFooter() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        + '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'
        + `<w:r><w:rPr>${fontXml(PAGE_NUMBER_FONT, PAGE_NUMBER_FONT)}${sizeXml(PAGE_NUMBER_SIZE_PT)}</w:rPr><w:fldChar w:fldCharType="begin"/></w:r>`
        + '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
        + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        + '<w:r><w:t>1</w:t></w:r>'
        + '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
        + '</w:p></w:ftr>';
}

function replaceStyleBlock(stylesXml, styleId, replacement) {
    const regex = new RegExp(`<w:style\\b(?=[^>]*w:styleId="${styleId}")[\\s\\S]*?</w:style>`);
    if (regex.test(stylesXml)) {
        return stylesXml.replace(regex, replacement);
    }

    return stylesXml;
}

function buildTemplate(baseZip, profile, language) {
    let stylesXml = baseZip.readAsText('word/styles.xml');

    for (const styleId of ['Normal', 'BodyText', 'FirstParagraph', 'Compact', 'Heading1', 'Heading2', 'Heading3', 'SourceCode', 'VerbatimChar']) {
        stylesXml = replaceStyleBlock(stylesXml, styleId, '');
    }

    stylesXml = stylesXml.replace(/<\/w:styles>\s*$/, `${buildStyles(profile, language)}</w:styles>`);

    let documentXml = baseZip.readAsText('word/document.xml');
    documentXml = documentXml.replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/, `<w:sectPr>${buildDocument(profile)}</w:sectPr>`);

    let contentTypes = baseZip.readAsText('[Content_Types].xml');
    contentTypes = contentTypes.replace(
        '</Types>',
        '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'
    );

    let rels = baseZip.readAsText('word/_rels/document.xml.rels');
    rels = rels.replace(
        '</Relationships>',
        `<Relationship Id="${FOOTER_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`
    );

    const output = new AdmZip();
    for (const entry of baseZip.getEntries()) {
        const name = entry.entryName;
        if (name === 'word/styles.xml') {
            output.addFile(name, Buffer.from(stylesXml, 'utf8'));
        } else if (name === 'word/document.xml') {
            output.addFile(name, Buffer.from(documentXml, 'utf8'));
        } else if (name === '[Content_Types].xml') {
            output.addFile(name, Buffer.from(contentTypes, 'utf8'));
        } else if (name === 'word/_rels/document.xml.rels') {
            output.addFile(name, Buffer.from(rels, 'utf8'));
        } else {
            output.addFile(name, entry.getData());
        }
    }

    output.addFile('word/footer1.xml', Buffer.from(buildFooter(), 'utf8'));

    return output;
}

function main() {
    if (!fs.existsSync(BASE_DOCX)) {
        console.error(`Base reference DOCX not found: ${BASE_DOCX}`);
        console.error('Create it with: pandoc --print-default-data-file reference.docx > scripts/reference-base.docx');
        process.exit(1);
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const baseZip = new AdmZip(BASE_DOCX);

    for (const profile of PROFILE_ORDER) {
        for (const language of LANGUAGE_ORDER) {
            const zip = buildTemplate(baseZip, profile, language);
            const target = path.join(OUTPUT_DIR, `reference_${language}_${profile}.docx`);
            zip.writeZip(target);
            console.log(`wrote ${path.relative(REPO_ROOT, target)}`);
        }
    }
}

main();
```

- [ ] **Step 5: 生成模板**

Run: `npm run build:templates`
Expected: 输出 10 行 `wrote multi-templates/reference_*.docx`

- [ ] **Step 6: 解除模板存在性测试的 skip，并修正它的路径**

`test/unit/profiles.test.js` 里有一条被 skip 的测试「every mapped bundled template file exists」。本任务生成完 10 个模板后，它应该真正跑起来。

1. **移除 `{ skip: '...' }` 选项。** 改完之后 `npm test` 的跳过数应该从 1 变成 0。
2. **确认路径拼接正确。** 映射表 `BUNDLED_REFERENCE_DOCX` 的值本身已经是 `'multi-templates/xxx.docx'`，所以应该用：

```js
const file = path.join(__dirname, '..', '..', relativePath);
```

而不是 `path.join(templateDir, relativePath)`（那会拼成 `multi-templates/multi-templates/xxx.docx`）。这一步在上一个任务里已经修好，请确认它没被改回去。

- [ ] **Step 7: 更新 `.vscodeignore` 的模板白名单**

`.vscodeignore` 里 `multi-templates/**` 被排除，只逐个白名单了 6 个模板文件。新增的 4 个（official ×2、thesis ×2）如果不加白名单，打出来的 .vsix 里就没有它们，运行时 `resolveReferenceDocx` 会报「Bundled reference DOCX was not found」。

把白名单段落替换为 10 个模板：

```
!multi-templates/reference_english_academic.docx
!multi-templates/reference_english_business.docx
!multi-templates/reference_english_technical.docx
!multi-templates/reference_english_official.docx
!multi-templates/reference_english_thesis.docx
!multi-templates/reference_chinese_academic.docx
!multi-templates/reference_chinese_business.docx
!multi-templates/reference_chinese_technical.docx
!multi-templates/reference_chinese_official.docx
!multi-templates/reference_chinese_thesis.docx
```

同时：

- **保留** `test_*.js` 这一行，**新增** `test/**`。不要替换 —— `test_*.js` 匹配的是仓库根目录下的 `test_full_pipeline.js`（Task 13 才会删掉它），`test/**` 匹配不到根目录文件，两个规则互补。
- 新增 `specs/**` 和 `CLAUDE.md`，避免把设计文档和 agent 说明打进 .vsix。

改完的 `.vscodeignore` 相关片段应为：

```
test_*.js
test/**
specs/**
CLAUDE.md
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npm test`
Expected: PASS —— 跳过数为 0

- [ ] **Step 9: 用 pandoc 验证产物可用**

Run:
```bash
printf '# 标题\n\n正文内容。\n' > /tmp/t.md
pandoc /tmp/t.md -o /tmp/t.docx --reference-doc multi-templates/reference_chinese_academic.docx
```
Expected: 退出码 0，`/tmp/t.docx` 存在

再用英文模板跑一次，确认正文用的是 Times New Roman 而不是宋体：

```bash
printf '# Title\n\nBody text.\n' > /tmp/te.md
pandoc /tmp/te.md -o /tmp/te.docx --reference-doc multi-templates/reference_english_academic.docx
python -c "import zipfile,re; s=zipfile.ZipFile('/tmp/te.docx').read('word/styles.xml').decode('utf8'); m=re.search(r'<w:style[^>]*w:styleId=\"Normal\"[^>]*>.*?</w:style>', s, re.S); print(m.group(0)[:300])"
```
Expected: `w:ascii="Times New Roman"` 且 `w:eastAsia="SimSun"`

- [ ] **Step 10: 提交**

```bash
git add scripts/build-templates.js scripts/reference-base.docx multi-templates/ test/unit/templates.test.js test/unit/profiles.test.js .vscodeignore
git commit -m "feat: regenerate all reference templates from a declarative style table"
```

提交信息就是上面这一行，不要加 body。仓库 CLAUDE.md 禁止任何 `Co-Authored-By:` / Claude 共同作者标记。


### Task 5b: 按显示名匹配样式（修掉孤儿样式与误伤）

**动机 —— 一个已实测确认的真实缺陷。**

插件的 DOCX 样式覆盖层按 `w:styleId` 找目标样式，但样式 id 是**每个模板各不同的**，靠一张硬编码的别名表去猜：

```ts
Normal:  styleId 'Normal', aliases ['a', 'a1', 'Text', 'BodyText', 'Body Text', 'FirstParagraph', 'Compact']
Heading1: styleId 'Heading1', aliases ['1']
Heading2: styleId 'Heading2', aliases ['2', '21']
Heading3: styleId 'Heading3', aliases ['3', '31']
```

实测三种模板下的真实映射：

| 显示名 | 旧中文模板 styleId | 旧英文模板 styleId | 新模板 styleId |
|---|---|---|---|
| Normal | `a1` | `a` | `Normal` |
| heading 1 / 2 / 3 | `1` / `21` / `31` | `1` / `2` / `3` | `Heading1` / `Heading2` / `Heading3` |
| Body Text | `af` | 不存在 | `BodyText` |
| Text | 不存在 | `Text` | 不存在 |
| **List Number** | **`a`** | 不存在 | 不存在 |
| **Normal Table** | `a3` | **`a1`** | 不存在 |

由此产生三个问题：

1. **每次导出都新建 10 个无人引用的孤儿样式。** 在新模板上实测：覆盖前 50 个样式 → 覆盖后 60 个，新建了 `a`, `a1`, `Text`, `Body Text`, `1`, `2`, `21`, `3`, `31`, `Code` —— 因为别名表里每个 legacy id 都不存在，`upsertStyleOverride()` 一律走「找不到 → 新建」分支。这些样式没有任何段落引用，纯粹是垃圾。
2. **正文样式误伤别的样式。** 旧中文模板里 `a` 是 **List Number**，旧英文模板里 `a1` 是 **Normal Table** —— 正文字体/字号/行距被套到了列表编号样式和表格样式上。
3. **整套装配靠逐模板硬编码 id 猜测**，换一个用户自带的 `reference.docx` 就可能全错。

Dify 插件早已避开这个问题：python-docx 的 `doc.styles[name]` **优先按显示名查**（`get_by_name`），styleId 只是已废弃的回退。VSC 侧要改成同一套思路。

**注意：** 「标题覆盖从未生效」这个说法并不准确 —— 旧模板的标题 id 恰好是 `1`/`2`/`21`/`3`/`31`，而别名表正好包含这些，所以标题**是生效的**（只是同时白造了三个孤儿 `Heading1/2/3`）。新模板下标题也能直接命中 `Heading1/2/3`。真正要修的是孤儿样式、误伤、以及脆弱的匹配机制。

**Files:**
- Create: `src/docxStyles.ts`（纯模块：DOCX XML 操作 + 样式匹配）
- Modify: `src/extension.ts`（改为引用新模块）
- Test: `test/unit/docxStyles.test.js`

#### Step 1：写失败的测试

`test/unit/docxStyles.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildDocxStyleOverrides,
    upsertStyleOverride,
    BODY_STYLE_NAMES,
    HEADING_1_STYLE_NAMES
} = require('../../out/docxStyles.js');

const STYLE_REGEX = /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g;

function styleIds(xml) {
    return [...xml.matchAll(/w:styleId="([^"]+)"/g)].map((m) => m[1]);
}

function styleByName(xml, name) {
    for (const block of xml.match(STYLE_REGEX) || []) {
        const found = block.match(/<w:name w:val="([^"]+)"/)?.[1];
        if (found && found.toLowerCase() === name.toLowerCase()) {
            return block;
        }
    }
    return undefined;
}

const LEGACY_CHINESE_STYLES = `
<w:style w:type="paragraph" w:styleId="a"><w:name w:val="List Number"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="a1"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="a3"><w:name w:val="Normal Table"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="21"><w:name w:val="heading 2"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="31"><w:name w:val="heading 3"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="af"><w:name w:val="Body Text"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
`;

const CANONICAL_STYLES = `
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FirstParagraph"><w:name w:val="First Paragraph"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Compact"><w:name w:val="Compact"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
`;

test('body override matches styles by display name, not by hard-coded ids', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(styleByName(updated, 'Normal').includes('w:ascii="Arial"'), 'Normal must be styled');
    assert.ok(styleByName(updated, 'Body Text').includes('w:ascii="Arial"'), 'Body Text must be styled');
});

test('body override does not touch List Number', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(!styleByName(updated, 'List Number').includes('Arial'), 'List Number must be left alone');
});

test('body override does not touch Normal Table', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(!styleByName(updated, 'Normal Table').includes('Arial'), 'Normal Table must be left alone');
});

test('heading override reaches the heading style regardless of its id', () => {
    const override = { styleId: 'Heading1', styleNames: HEADING_1_STYLE_NAMES, asciiFont: 'SimHei', eastAsiaFont: 'SimHei', sizePt: 16 };
    const updated = upsertStyleOverride(LEGACY_CHINESE_STYLES, override);

    assert.ok(styleByName(updated, 'heading 1').includes('w:ascii="SimHei"'), 'heading 1 must be styled');
});

test('no orphan styles are created when the target already exists', () => {
    const override = { styleId: 'Heading1', styleNames: HEADING_1_STYLE_NAMES, asciiFont: 'SimHei', eastAsiaFont: 'SimHei', sizePt: 16 };
    const before = styleIds(LEGACY_CHINESE_STYLES);
    const after = styleIds(upsertStyleOverride(LEGACY_CHINESE_STYLES, override));

    assert.deepEqual(after.sort(), before.sort(), 'no style may be added');
});

test('no orphan styles are created for canonical templates either', () => {
    const override = { styleId: 'Normal', styleNames: BODY_STYLE_NAMES, asciiFont: 'Arial', eastAsiaFont: 'Arial', sizePt: 11 };
    const before = styleIds(CANONICAL_STYLES);
    const after = styleIds(upsertStyleOverride(CANONICAL_STYLES, override));

    assert.deepEqual(after.sort(), before.sort(), 'no style may be added');
});

test('a genuinely missing style is still created', () => {
    const override = { styleId: 'Heading1', styleNames: HEADING_1_STYLE_NAMES, asciiFont: 'SimHei', eastAsiaFont: 'SimHei', sizePt: 16 };
    const updated = upsertStyleOverride('<w:styles></w:styles>', override);

    assert.ok(styleIds(updated).includes('Heading1'), 'the missing style must be inserted');
});

test('buildDocxStyleOverrides returns overrides that carry display names', () => {
    const overrides = buildDocxStyleOverrides({
        styleProfile: 'academic',
        bodyFont: '', bodySizePt: undefined,
        heading1Font: '', heading1SizePt: undefined,
        heading2Font: '', heading2SizePt: undefined,
        heading3Font: '', heading3SizePt: undefined,
        lineSpacing: undefined
    });

    const normal = overrides.find((o) => o.styleId === 'Normal');
    assert.ok(normal.styleNames.includes('Normal'));
    assert.ok(normal.styleNames.includes('Body Text'));
    assert.ok(!normal.styleNames.includes('List Number'));
});

test('the template profile produces no overrides at all', () => {
    const overrides = buildDocxStyleOverrides({
        styleProfile: 'template',
        bodyFont: '', bodySizePt: undefined,
        heading1Font: '', heading1SizePt: undefined,
        heading2Font: '', heading2SizePt: undefined,
        heading3Font: '', heading3SizePt: undefined,
        lineSpacing: undefined
    });

    assert.deepEqual(overrides, []);
});
```

#### Step 2：运行测试确认失败

Run: `npm test`
Expected: FAIL —— `Cannot find module '../../out/docxStyles.js'`

#### Step 3：创建 `src/docxStyles.ts`

把 `src/extension.ts` 里现有的纯 XML 操作函数**整体搬过来**，并把匹配逻辑改成按显示名：

```ts
import { PROFILE_PRESETS } from './profiles';
import type { CodeStyle, ProfilePreset, StyleProfile } from './profiles';

export interface DocxStyleOverride {
    styleId: string;
    /** Display names (w:name) to match. Matched case-insensitively. */
    styleNames: string[];
    asciiFont?: string;
    eastAsiaFont?: string;
    sizePt?: number;
    lineSpacingTwips?: number;
    lineSpacingRule?: 'auto' | 'exact';
    color?: string;
    shadingFill?: string;
}

/**
 * Display names of the paragraph styles that carry body text.
 *
 * Matched by name, never by id: style ids differ between templates
 * (Chinese Word templates use `a`/`a1`, pandoc's use `Normal`), while
 * display names are stable. `Text` covers English templates that name the
 * body style `Text`; `List Number` and `Normal Table` are deliberately
 * absent — they are different styles that happen to own the ids `a`/`a1`
 * in some templates.
 */
export const BODY_STYLE_NAMES = ['Normal', 'Body Text', 'Text', 'First Paragraph', 'Compact'];
export const HEADING_1_STYLE_NAMES = ['heading 1'];
export const HEADING_2_STYLE_NAMES = ['heading 2'];
export const HEADING_3_STYLE_NAMES = ['heading 3'];
export const SOURCE_CODE_STYLE_NAMES = ['Source Code'];
export const VERBATIM_CHAR_STYLE_NAMES = ['Verbatim Char'];

const STYLE_BLOCK_REGEX = /<w:style\b[^>]*>[\s\S]*?<\/w:style>/g;

export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function ensureChildElement(xml: string, tagName: string): string {
    if (new RegExp(`<${tagName}\\b`).test(xml)) {
        return xml;
    }

    return xml.replace(/(<w:style\b[^>]*>)/, `$1<${tagName}/>`);
}

export function upsertInsideElement(xml: string, tagName: string, childRegex: RegExp, childXml: string): string {
    const elementRegex = new RegExp(`<${tagName}\\b[^>]*(?:/>|>[\\s\\S]*?</${tagName}>)`);
    return xml.replace(elementRegex, (elementXml) => {
        if (childRegex.test(elementXml)) {
            return elementXml.replace(childRegex, childXml);
        }

        if (elementXml.endsWith('/>')) {
            return elementXml.replace(/\/>$/, `>${childXml}</${tagName}>`);
        }

        return elementXml.replace(new RegExp(`</${tagName}>$`), `${childXml}</${tagName}>`);
    });
}

export function upsertXmlAttribute(xml: string, attrName: string, value: string): string {
    const attrRegex = new RegExp(`${escapeRegex(attrName)}="[^"]*"`);
    if (attrRegex.test(xml)) {
        return xml.replace(attrRegex, `${attrName}="${escapeXmlAttribute(value)}"`);
    }

    return xml.replace(/<(\w+:\w+)([^>]*)\/>/, (match, tag, attrs) => `<${tag}${attrs} ${attrName}="${escapeXmlAttribute(value)}"/>`);
}

export function upsertLineSpacingAttributes(xml: string, lineTwips: number, rule: string): string {
    let updated = upsertXmlAttribute(xml, 'w:line', String(lineTwips));
    updated = upsertXmlAttribute(updated, 'w:lineRule', rule);
    return updated;
}

export function updateStyleXml(styleXml: string, override: DocxStyleOverride): string {
    let updated = styleXml;
    updated = ensureChildElement(updated, 'w:rPr');

    if (override.lineSpacingTwips || override.shadingFill) {
        updated = ensureChildElement(updated, 'w:pPr');
    }

    if (override.asciiFont || override.eastAsiaFont) {
        const ascii = override.asciiFont || override.eastAsiaFont || '';
        const eastAsia = override.eastAsiaFont || override.asciiFont || '';
        const fontXml = `<w:rFonts w:ascii="${escapeXmlAttribute(ascii)}" w:hAnsi="${escapeXmlAttribute(ascii)}" w:eastAsia="${escapeXmlAttribute(eastAsia)}" w:cs="${escapeXmlAttribute(ascii)}"/>`;
        updated = upsertInsideElement(updated, 'w:rPr', /<w:rFonts\b[^>]*\/>/, fontXml);
    }

    if (override.sizePt) {
        const halfPoints = String(Math.round(override.sizePt * 2));
        updated = upsertInsideElement(updated, 'w:rPr', /<w:sz\b[^>]*\/>/, `<w:sz w:val="${halfPoints}"/>`);
        updated = upsertInsideElement(updated, 'w:rPr', /<w:szCs\b[^>]*\/>/, `<w:szCs w:val="${halfPoints}"/>`);
    }

    if (override.lineSpacingTwips) {
        const rule = override.lineSpacingRule ?? 'auto';
        updated = upsertLineSpacingAttributes(updated, override.lineSpacingTwips, rule);
    }

    if (override.color) {
        updated = upsertInsideElement(updated, 'w:rPr', /<w:color\b[^>]*\/>/, `<w:color w:val="${escapeXmlAttribute(override.color)}"/>`);
    }

    if (override.shadingFill) {
        updated = upsertInsideElement(updated, 'w:pPr', /<w:shd\b[^>]*\/>/, `<w:shd w:val="clear" w:color="auto" w:fill="${escapeXmlAttribute(override.shadingFill)}"/>`);
    }

    return updated;
}

export function insertDocxStyle(stylesXml: string, override: DocxStyleOverride): string {
    const styleType = override.styleId.endsWith('Char') ? 'character' : 'paragraph';
    const styleName = override.styleId.replace(/([a-z])([A-Z])/g, '$1 $2');
    const baseStyleXml = `<w:style w:type="${styleType}" w:customStyle="1" w:styleId="${escapeXmlAttribute(override.styleId)}"><w:name w:val="${escapeXmlAttribute(styleName)}"/></w:style>`;
    const updatedStyleXml = updateStyleXml(baseStyleXml, override);
    return stylesXml.replace(/<\/w:styles>\s*$/, `${updatedStyleXml}</w:styles>`);
}

/**
 * Apply an override to every style whose display name matches, plus the
 * style whose id matches exactly. Creates the style only when nothing
 * matched — matching by name first is what keeps this from spawning
 * duplicate styles alongside an existing heading style.
 */
export function upsertStyleOverride(stylesXml: string, override: DocxStyleOverride): string {
    const wantedNames = new Set(override.styleNames.map((name) => name.toLowerCase()));
    let matched = false;

    const updated = stylesXml.replace(STYLE_BLOCK_REGEX, (styleXml) => {
        const styleId = styleXml.match(/w:styleId="([^"]+)"/)?.[1];
        const styleName = styleXml.match(/<w:name w:val="([^"]+)"/)?.[1];

        const idMatches = styleId === override.styleId;
        const nameMatches = styleName !== undefined && wantedNames.has(styleName.toLowerCase());

        if (!idMatches && !nameMatches) {
            return styleXml;
        }

        matched = true;
        return updateStyleXml(styleXml, override);
    });

    if (matched) {
        return updated;
    }

    return insertDocxStyle(updated, override);
}

export interface StyleOverrideInput {
    styleProfile: StyleProfile;
    bodyFont: string;
    bodySizePt?: number;
    heading1Font: string;
    heading1SizePt?: number;
    heading2Font: string;
    heading2SizePt?: number;
    heading3Font: string;
    heading3SizePt?: number;
    lineSpacing?: number;
}

export function buildDocxStyleOverrides(settings: StyleOverrideInput): DocxStyleOverride[] {
    const preset: ProfilePreset = PROFILE_PRESETS[settings.styleProfile];
    const effectiveColor = preset.color;
    const bodyFont = resolveFontPair(settings.bodyFont, preset.body);
    const heading1Font = resolveFontPair(settings.heading1Font, preset.heading1);
    const heading2Font = resolveFontPair(settings.heading2Font, preset.heading2);
    const heading3Font = resolveFontPair(settings.heading3Font, preset.heading3);
    const lineSpacing = resolveLineSpacingTwips(settings.styleProfile, settings.lineSpacing);

    const overrides: DocxStyleOverride[] = [
        {
            styleId: 'Normal',
            styleNames: BODY_STYLE_NAMES,
            asciiFont: bodyFont?.ascii,
            eastAsiaFont: bodyFont?.eastAsia,
            sizePt: settings.bodySizePt ?? preset.bodySizePt,
            lineSpacingTwips: lineSpacing?.twips,
            lineSpacingRule: lineSpacing?.rule,
            color: effectiveColor
        },
        {
            styleId: 'Heading1',
            styleNames: HEADING_1_STYLE_NAMES,
            asciiFont: heading1Font?.ascii,
            eastAsiaFont: heading1Font?.eastAsia,
            sizePt: settings.heading1SizePt ?? preset.heading1SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading2',
            styleNames: HEADING_2_STYLE_NAMES,
            asciiFont: heading2Font?.ascii,
            eastAsiaFont: heading2Font?.eastAsia,
            sizePt: settings.heading2SizePt ?? preset.heading2SizePt,
            color: effectiveColor
        },
        {
            styleId: 'Heading3',
            styleNames: HEADING_3_STYLE_NAMES,
            asciiFont: heading3Font?.ascii,
            eastAsiaFont: heading3Font?.eastAsia,
            sizePt: settings.heading3SizePt ?? preset.heading3SizePt,
            color: effectiveColor
        }
    ];

    if (preset.codeStyle) {
        overrides.push(...buildCodeStyleOverrides(preset.codeStyle));
    }

    return overrides.filter((override) => hasDocxStyleOverrideValue(override));
}

export function buildCodeStyleOverrides(codeStyle: CodeStyle): DocxStyleOverride[] {
    return [
        {
            styleId: 'SourceCode',
            styleNames: SOURCE_CODE_STYLE_NAMES,
            asciiFont: codeStyle.font,
            eastAsiaFont: codeStyle.font,
            sizePt: codeStyle.sizePt,
            lineSpacingTwips: Math.round(codeStyle.lineSpacing * 240),
            lineSpacingRule: 'auto',
            color: '000000',
            shadingFill: codeStyle.shadingFill
        },
        {
            styleId: 'VerbatimChar',
            styleNames: VERBATIM_CHAR_STYLE_NAMES,
            asciiFont: codeStyle.font,
            eastAsiaFont: codeStyle.font,
            sizePt: codeStyle.sizePt,
            color: '000000'
        }
    ];
}

export function hasDocxStyleOverrideValue(override: DocxStyleOverride): boolean {
    return Boolean(
        override.asciiFont
        || override.eastAsiaFont
        || override.sizePt
        || override.lineSpacingTwips
        || override.color
        || override.shadingFill
    );
}
```

**注意：** `resolveFontPair` 和 `resolveLineSpacingTwips` 从 `./profiles` import（它们已经是纯模块里的导出）。

#### Step 4：改写 `src/extension.ts`

- import 段加入：

```ts
import {
    buildDocxStyleOverrides,
    escapeRegex,
    escapeXmlAttribute,
    ensureChildElement,
    insertDocxStyle,
    updateStyleXml,
    upsertInsideElement,
    upsertLineSpacingAttributes,
    upsertStyleOverride,
    upsertXmlAttribute
} from './docxStyles';
import type { DocxStyleOverride } from './docxStyles';
```

- **删除** `src/extension.ts` 里这些本地定义（已搬到新模块）：`escapeRegex`、`escapeXmlAttribute`、`ensureChildElement`、`upsertInsideElement`、`upsertXmlAttribute`、`upsertLineSpacingAttributes`、`updateStyleXml`、`insertDocxStyle`、`upsertStyleOverride`、`applyStyleOverrideToPrimaryAndAliases`、`hasDocxStyleOverrideValue`、`buildCodeStyleOverrides`、`buildDocxStyleOverrides`，以及 `interface DocxStyleOverride`。

- `applyDocxStyleOverrides()` 里原来调用 `applyStyleOverrideToPrimaryAndAliases(stylesXml, override)` 的地方，改为调用 `upsertStyleOverride(stylesXml, override)`。

- `buildDocxStyleOverrides(settings)` 现在从 `./docxStyles` 导入，调用点不变（它接受 `ExportSettings`，而 `ExportSettings` 的字段是 `styleProfile`/`bodyFont`/`bodySizePt`/... ，与 `StyleOverrideInput` 结构兼容 —— `ExportSettings` 多出的字段不影响）。

  如果 TypeScript 报类型不兼容，就在调用点显式构造：

```ts
const docxStyleOverrides = buildDocxStyleOverrides({
    styleProfile: settings.styleProfile,
    bodyFont: settings.bodyFont,
    bodySizePt: settings.bodySizePt,
    heading1Font: settings.heading1Font,
    heading1SizePt: settings.heading1SizePt,
    heading2Font: settings.heading2Font,
    heading2SizePt: settings.heading2SizePt,
    heading3Font: settings.heading3Font,
    heading3SizePt: settings.heading3SizePt,
    lineSpacing: settings.lineSpacing
});
```

  优先用显式构造 —— 明确、无歧义。

- `exportDocxStyleOverrides`（如果 `extension.ts` 里为了测试导出过）—— 如果有，确认它仍然工作。

#### Step 5：运行测试确认通过

Run: `npm test`
Expected: PASS

#### Step 6：端到端验证「不再产生孤儿样式」

用真实模板跑一遍，覆盖前后对比样式数量：

```bash
node -e "
const fs=require('fs');
const AdmZip=require('adm-zip');
const D=require('./out/docxStyles.js');
const zip=new AdmZip('multi-templates/reference_english_technical.docx');
let styles=zip.readAsText('word/styles.xml');
const before=[...styles.matchAll(/w:styleId=\"([^\"]+)\"/g)].length;
for (const o of D.buildDocxStyleOverrides({styleProfile:'technical',bodyFont:'',bodySizePt:undefined,heading1Font:'',heading1SizePt:undefined,heading2Font:'',heading2SizePt:undefined,heading3Font:'',heading3SizePt:undefined,lineSpacing:undefined})) {
  styles=D.upsertStyleOverride(styles,o);
}
const after=[...styles.matchAll(/w:styleId=\"([^\"]+)\"/g)].length;
console.log('覆盖前', before, '覆盖后', after, after===before ? '=> 无孤儿样式 PASS' : '=> 仍产生孤儿 FAIL');
"
```

Expected: `覆盖前 50 覆盖后 50 => 无孤儿样式 PASS`

#### Step 7：提交

```bash
git add src/docxStyles.ts src/extension.ts test/unit/docxStyles.test.js
git commit -m "fix: match DOCX styles by display name instead of hard-coded style ids
```

提交信息就是上面这一行。仓库 CLAUDE.md 禁止任何 `Co-Authored-By:` / Claude 共同作者标记。


### Task 6: Dify 侧同步

**Files:**
- Modify: `scripts/sync-templates.sh`
- Modify: `dify-plugin-MD2Docx/src/md2docx.py`
- Modify: `dify-plugin-MD2Docx/multi-templates/`（同步 10 个）

- [ ] **Step 1: 扩展同步脚本的模板清单**

`scripts/sync-templates.sh` 里的 `TEMPLATES=( ... )` 改为：

```bash
TEMPLATES=(
    "reference_english_academic.docx"
    "reference_english_technical.docx"
    "reference_english_business.docx"
    "reference_english_official.docx"
    "reference_english_thesis.docx"
    "reference_chinese_academic.docx"
    "reference_chinese_technical.docx"
    "reference_chinese_business.docx"
    "reference_chinese_official.docx"
    "reference_chinese_thesis.docx"
)
```

同时把文件头注释里的 `# Template files (8 total):` 改为 `# Template files (10 total):`，并把下面的两行：

```bash
#   reference_{english,chinese}_{academic,technical,business,official}.docx
```

改为：

```bash
#   reference_{english,chinese}_{academic,technical,business,official,thesis}.docx
```

- [ ] **Step 2: 运行同步脚本**

Run: `bash scripts/sync-templates.sh`
Expected: 报告复制 10 个文件，无 mismatch

- [ ] **Step 3: 更新 Dify 的 TEMPLATE_MAP**

`dify-plugin-MD2Docx/src/md2docx.py` 的 `TEMPLATE_MAP` 改为：

```python
TEMPLATE_MAP: dict[str, dict[str, str]] = {
    "academic": {
        "english": "reference_english_academic.docx",
        "chinese": "reference_chinese_academic.docx",
    },
    "template": {
        "english": "reference_english_academic.docx",
        "chinese": "reference_chinese_academic.docx",
    },
    "technical": {
        "english": "reference_english_technical.docx",
        "chinese": "reference_chinese_technical.docx",
    },
    "business": {
        "english": "reference_english_business.docx",
        "chinese": "reference_chinese_business.docx",
    },
    "official": {
        "english": "reference_english_official.docx",
        "chinese": "reference_chinese_official.docx",
    },
    "thesis": {
        "english": "reference_english_thesis.docx",
        "chinese": "reference_chinese_thesis.docx",
    },
}
```

- [ ] **Step 4: Dify 的字体分槽**

`PROFILE_DEFAULTS` 里每个 profile 的 `body_font` / `headingN_font` 拆成两个字段。改法：把 `PROFILE_DEFAULTS` 改为下面的结构（其余字段不变）：

```python
PROFILE_DEFAULTS: dict[str, dict[str, Any]] = {
    "academic": {
        "body_ascii_font": "Times New Roman",
        "body_east_asia_font": "SimSun",
        "body_size_pt": 12,
        "heading1_ascii_font": "Times New Roman",
        "heading1_east_asia_font": "SimHei",
        "heading1_size_pt": 16,
        "heading2_ascii_font": "Times New Roman",
        "heading2_east_asia_font": "SimHei",
        "heading2_size_pt": 14,
        "heading3_ascii_font": "Times New Roman",
        "heading3_east_asia_font": "SimHei",
        "heading3_size_pt": 12,
        "line_spacing": 1.5,
        "margin_top_mm": 25.4,
        "margin_bottom_mm": 25.4,
        "margin_left_mm": 31.75,
        "margin_right_mm": 31.75,
    },
    "business": {
        "body_ascii_font": "Arial",
        "body_east_asia_font": "Microsoft YaHei",
        "body_size_pt": 11,
        "heading1_ascii_font": "Arial",
        "heading1_east_asia_font": "Microsoft YaHei",
        "heading1_size_pt": 18,
        "heading2_ascii_font": "Arial",
        "heading2_east_asia_font": "Microsoft YaHei",
        "heading2_size_pt": 14,
        "heading3_ascii_font": "Arial",
        "heading3_east_asia_font": "Microsoft YaHei",
        "heading3_size_pt": 12,
        "line_spacing": 1.5,
        "margin_top_mm": 25.4,
        "margin_bottom_mm": 25.4,
        "margin_left_mm": 25.4,
        "margin_right_mm": 25.4,
    },
    "technical": {
        "body_ascii_font": "Arial",
        "body_east_asia_font": "Microsoft YaHei",
        "body_size_pt": 11,
        "heading1_ascii_font": "Arial",
        "heading1_east_asia_font": "Microsoft YaHei",
        "heading1_size_pt": 16,
        "heading2_ascii_font": "Arial",
        "heading2_east_asia_font": "Microsoft YaHei",
        "heading2_size_pt": 14,
        "heading3_ascii_font": "Arial",
        "heading3_east_asia_font": "Microsoft YaHei",
        "heading3_size_pt": 12,
        "line_spacing": 1.35,
        "margin_top_mm": 19,
        "margin_bottom_mm": 19,
        "margin_left_mm": 19,
        "margin_right_mm": 19,
    },
    "official": {
        "body_ascii_font": "Times New Roman",
        "body_east_asia_font": "FangSong",
        "body_size_pt": 16,
        "heading1_ascii_font": "Times New Roman",
        "heading1_east_asia_font": "SimHei",
        "heading1_size_pt": 16,
        "heading2_ascii_font": "Times New Roman",
        "heading2_east_asia_font": "KaiTi",
        "heading2_size_pt": 16,
        "heading3_ascii_font": "Times New Roman",
        "heading3_east_asia_font": "FangSong",
        "heading3_size_pt": 16,
        "line_spacing": 1.75,
        "margin_top_mm": 37,
        "margin_bottom_mm": 35,
        "margin_left_mm": 28,
        "margin_right_mm": 26,
    },
    "thesis": {
        "body_ascii_font": "Times New Roman",
        "body_east_asia_font": "SimSun",
        "body_size_pt": 12,
        "heading1_ascii_font": "Times New Roman",
        "heading1_east_asia_font": "SimHei",
        "heading1_size_pt": 22,
        "heading2_ascii_font": "Times New Roman",
        "heading2_east_asia_font": "SimHei",
        "heading2_size_pt": 16,
        "heading3_ascii_font": "Times New Roman",
        "heading3_east_asia_font": "SimHei",
        "heading3_size_pt": 14,
        "line_spacing": 1.5,
        "margin_top_mm": 30,
        "margin_bottom_mm": 30,
        "margin_left_mm": 30,
        "margin_right_mm": 30,
    },
    "template": {},
}
```

`_set_font` 改为接受两个字体名：

```python
def _set_font(run_or_style, ascii_font: str | None = None, east_asia_font: str | None = None) -> None:
    """Set the latin and east-asian fonts on a run or style element."""
    rPr = run_or_style._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = etree.SubElement(rPr, qn("w:rFonts"))
    if ascii_font:
        rFonts.set(qn("w:ascii"), ascii_font)
        rFonts.set(qn("w:hAnsi"), ascii_font)
        rFonts.set(qn("w:cs"), ascii_font)
    if east_asia_font:
        rFonts.set(qn("w:eastAsia"), east_asia_font)
```

技术档的代码样式调用点也要跟着改，否则 `eastAsia` 槽位会留空：

```python
            _set_font(cs, "Consolas", "Consolas")
```

`_apply_to_styles` 的 `font=` 参数改为 `ascii_font=` 与 `east_asia_font=`：

```python
def _apply_to_styles(doc: Document, names: tuple[str, ...], *, ascii_font=None,
                     east_asia_font=None, size=None, color=None,
                     line_spacing=None) -> bool:
    """Apply font/size/color/line_spacing to matching style names. Returns True
    if at least one style was found and modified.
    """
    matched = False
    for name in names:
        try:
            style = doc.styles[name]
            matched = True
            if ascii_font or east_asia_font:
                _set_font(style, ascii_font, east_asia_font)
            if size:
                _set_font_size(style, size)
            if color:
                _set_font_color(style, color)
            if line_spacing:
                _set_line_spacing(style.paragraph_format, line_spacing)
        except KeyError:
            pass
    return matched
```

`apply_style_overrides` 里的取值部分改为：

```python
    body_ascii = params.get("body_font") or profile.get("body_ascii_font")
    body_east_asia = params.get("body_font") or profile.get("body_east_asia_font")
    body_size = parse_pt(params.get("body_size_pt")) or profile.get("body_size_pt")
    line_spacing = parse_spacing(params.get("line_spacing")) or profile.get("line_spacing")

    h1_ascii = params.get("heading1_font") or profile.get("heading1_ascii_font")
    h1_east_asia = params.get("heading1_font") or profile.get("heading1_east_asia_font")
    h1_size = parse_pt(params.get("heading1_size_pt")) or profile.get("heading1_size_pt")
    h2_ascii = params.get("heading2_font") or profile.get("heading2_ascii_font")
    h2_east_asia = params.get("heading2_font") or profile.get("heading2_east_asia_font")
    h2_size = parse_pt(params.get("heading2_size_pt")) or profile.get("heading2_size_pt")
    h3_ascii = params.get("heading3_font") or profile.get("heading3_ascii_font")
    h3_east_asia = params.get("heading3_font") or profile.get("heading3_east_asia_font")
    h3_size = parse_pt(params.get("heading3_size_pt")) or profile.get("heading3_size_pt")
```

并把三处 `_apply_to_styles(...)` 调用改为传 `ascii_font=` / `east_asia_font=`：

```python
    if not _apply_to_styles(doc, NORMAL_STYLE_NAMES, ascii_font=body_ascii,
                             east_asia_font=body_east_asia, size=body_size,
                             color=effective_color, line_spacing=line_spacing):
```

```python
    if not _apply_to_styles(doc, HEADING_ALIASES["Heading 1"], ascii_font=h1_ascii,
                             east_asia_font=h1_east_asia, size=h1_size,
                             color=effective_color):
```

```python
    if not _apply_to_styles(doc, HEADING_ALIASES["Heading 2"], ascii_font=h2_ascii,
                             east_asia_font=h2_east_asia, size=h2_size,
                             color=effective_color):
```

```python
    if not _apply_to_styles(doc, HEADING_ALIASES["Heading 3"], ascii_font=h3_ascii,
                             east_asia_font=h3_east_asia, size=h3_size,
                             color=effective_color):
```

- [ ] **Step 4b: 注意工作区里已有的未提交改动**

`dify-plugin-MD2Docx/src/` 与 `dify-plugin-MD2Docx/tests/` 在本任务开始前就有未提交的改动（pandoc 警告收集、Mermaid 渲染器重构、新增 `tests/test_mermaid_converter.py`），不属于本次工作。

执行前先跑 `git -C ../.. status --short` 确认这些改动仍在，然后：

- **不要**用 `git checkout` / `git restore` 丢弃它们。
- 本任务的编辑要叠加在这些改动之上，`_set_font` 的签名变化要同时适配代码样式的调用点。
- 提交时只 `git add` 本任务真正改到的文件与行；如果上述未提交改动与本任务落在同一文件里，提交前先确认 diff 内容是否属于本任务，把不属于本任务的 hunk 留在工作区。

- [ ] **Step 4c: 修正 Dify 侧 CJK 正则的下界**

Dify 的 `src/md2docx.py` 里这一行的区间下界是错的：

```python
CJK_CHAR_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
```

第三段区间实际是 `U+8C48`–`U+FAFF`（下界抄成了「豈」而不是 `U+F900` 的 CJK 兼容汉字），因此**谚文音节 U+AC00–U+D7AF 和彝文音节都被算成中文** —— 韩文文档会被判成中文而选到中文模板，而 VS Code 侧（修正后的 `U+F900`）会判成英文。两端行为不一致。

改成显式转义，与 VS Code 侧完全一致：

```python
CJK_CHAR_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
```

注意这里是 Python 原始字符串，`\u` 在 `r"..."` 里会原样保留成反斜杠+u，Python 的 `re` 模块自己会解析成码位 —— 所以正则层面是正确的。

- [ ] **Step 5: 语法检查与测试**

Run:
```bash
cd dify-plugin-MD2Docx
python -c "import ast; ast.parse(open('src/md2docx.py').read()); print('Syntax OK')"
pytest tests/ -q
```
Expected: `Syntax OK`，测试全绿（若 pytest 未安装，先 `pip install -r requirements-dev.txt`）

- [ ] **Step 6: 提交**

```bash
git add scripts/sync-templates.sh dify-plugin-MD2Docx/src/md2docx.py dify-plugin-MD2Docx/multi-templates/
git commit -m "feat: sync templates and split fonts into latin/east-asian slots on the Dify side

thesis now points at its own GB/T 7713 template instead of reusing the
academic one, and the DOCX style override writes w:ascii and w:eastAsia
separately so English documents stop inheriting SimSun."
```

---

## Phase 2 — 功能补齐

### Task 7: `src/mermaid.ts` —— Mermaid Ink 客户端与渲染策略

**Files:**
- Create: `src/mermaid.ts`
- Test: `test/unit/mermaid.test.js`

- [ ] **Step 1: 写失败的测试**

`test/unit/mermaid.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { parseMermaidBlocks, encodeMermaidPako, MERMAID_BLOCK_REGEX } = require('../../out/mermaid.js');

test('parseMermaidBlocks finds a single block', () => {
    const blocks = parseMermaidBlocks('# Title\n\n```mermaid\ngraph TD; A-->B\n```\n\nafter');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].code, 'graph TD; A-->B');
    assert.ok(blocks[0].start >= 0);
    assert.ok(blocks[0].end > blocks[0].start);
});

test('parseMermaidBlocks finds multiple blocks', () => {
    const blocks = parseMermaidBlocks('```mermaid\nA\n```\ntext\n```mermaid\nB\n```');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].code, 'A');
    assert.equal(blocks[1].code, 'B');
});

test('parseMermaidBlocks returns nothing when there is no mermaid fence', () => {
    assert.deepEqual(parseMermaidBlocks('# Title\n\n```js\nconsole.log(1)\n```'), []);
});

test('parseMermaidBlocks keeps inline code inside the body', () => {
    const blocks = parseMermaidBlocks('```mermaid\ngraph TD; A["`x`"]-->B\n```');
    assert.equal(blocks.length, 1);
    assert.ok(blocks[0].code.includes('A["`x`"]'));
});

test('encodeMermaidPako round-trips through inflate', () => {
    const encoded = encodeMermaidPako('graph TD; A-->B');
    assert.ok(!encoded.includes('='), 'base64url must be unpadded');
    assert.ok(!encoded.includes('+') && !encoded.includes('/'), 'must be base64url');
    const json = zlib.inflateSync(Buffer.from(encoded, 'base64url')).toString('utf8');
    assert.deepEqual(JSON.parse(json), { code: 'graph TD; A-->B' });
});

test('encodeMermaidPako matches the Dify plugin payload format', () => {
    // Python: zlib.compress(json.dumps({"code": code}, separators=(",", ":")).encode(), 9)
    const encoded = encodeMermaidPako('graph TD; A-->B');
    const raw = Buffer.from(encoded, 'base64url');
    assert.equal(raw[0], 0x78, 'must be a zlib stream');
    const json = zlib.inflateSync(raw).toString('utf8');
    assert.equal(json, '{"code":"graph TD; A-->B"}', 'must match Python json.dumps separators');
});

test('the block regex is anchored to line starts', () => {
    assert.ok(MERMAID_BLOCK_REGEX.flags.includes('m'));
    assert.ok(MERMAID_BLOCK_REGEX.flags.includes('g'));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '../../out/mermaid.js'`

- [ ] **Step 3: 创建 `src/mermaid.ts`**

```ts
import * as https from 'https';
import * as zlib from 'zlib';

export const MERMAID_BLOCK_REGEX = /^```mermaid[^\n]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gim;

export const MERMAID_REQUEST_TIMEOUT_MS = 30_000;
export const MERMAID_MAX_ATTEMPTS = 3;
export const MERMAID_RETRY_DELAYS_MS = [1000, 2000];
export const MERMAID_TOTAL_BUDGET_MS = 120_000;

export interface MermaidBlock {
    code: string;
    start: number;
    end: number;
}

export interface MermaidRenderOptions {
    apiUrl: string;
    timeoutMs?: number;
    maxAttempts?: number;
    retryDelaysMs?: number[];
}

export function parseMermaidBlocks(markdownText: string): MermaidBlock[] {
    const blocks: MermaidBlock[] = [];
    const regex = new RegExp(MERMAID_BLOCK_REGEX.source, MERMAID_BLOCK_REGEX.flags);

    let match = regex.exec(markdownText);
    while (match) {
        blocks.push({
            code: match[1],
            start: match.index,
            end: match.index + match[0].length
        });
        match = regex.exec(markdownText);
    }

    return blocks;
}

> 已实测：Node 与 Python 的 zlib 在同一 level 9 下**压缩字节不同**（两边的 zlib 构建版本不同），但 Node 产出的是合法的 zlib 流（首字节 `78 da`），Python 的 `zlib.decompress` 能正确解开并还原出完全一致的 `{"code": ...}` JSON。Mermaid Ink 服务端只做标准 inflate，因此格式兼容即可，不需要追求与 Python 逐字节相同。

export function encodeMermaidPako(diagram: string): string {
    const payload = JSON.stringify({ code: diagram });
    return zlib.deflateSync(Buffer.from(payload, 'utf8'), { level: 9 }).toString('base64url');
}

export function renderMermaidViaInk(diagram: string, options: MermaidRenderOptions): Promise<Buffer> {
    const timeoutMs = options.timeoutMs ?? MERMAID_REQUEST_TIMEOUT_MS;
    const baseUrl = options.apiUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/img/pako:${encodeMermaidPako(diagram)}`;

    return new Promise<Buffer>((resolve, reject) => {
        const request = https.get(url, { headers: { 'User-Agent': 'mdocx-converter' } }, (response) => {
            const status = response.statusCode ?? 0;

            if (status >= 300 && status < 400 && response.headers.location) {
                response.resume();
                reject(new Error(`Mermaid Ink redirected to ${response.headers.location}`));
                return;
            }

            if (status !== 200) {
                response.resume();
                reject(new Error(`Mermaid Ink returned HTTP ${status}`));
                return;
            }

            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });

        request.setTimeout(timeoutMs, () => {
            request.destroy(new Error(`Mermaid Ink request timed out after ${timeoutMs}ms`));
        });

        request.on('error', reject);
    });
}

export async function renderMermaidWithRetry(
    diagram: string,
    options: MermaidRenderOptions
): Promise<Buffer> {
    const maxAttempts = options.maxAttempts ?? MERMAID_MAX_ATTEMPTS;
    const retryDelays = options.retryDelaysMs ?? MERMAID_RETRY_DELAYS_MS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await renderMermaidViaInk(diagram, options);
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                const delay = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)];
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/mermaid.ts test/unit/mermaid.test.js
git commit -m "feat: add mermaid block parser and Mermaid Ink API client"
```

---

### Task 8: 渲染策略接线（local → api 兜底 + 失败降级）

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`（新增 2 个设置）

- [ ] **Step 1: 在 package.json 增加设置**

`contributes.configuration.properties` 里加入：

```json
        "mdocxConverter.mermaidRenderer": {
          "type": "string",
          "enum": [
            "auto",
            "local",
            "api"
          ],
          "enumDescriptions": [
            "Render with the local Mermaid CLI first and fall back to the Mermaid Ink API when mmdc is unavailable.",
            "Render with the local Mermaid CLI only. Export fails with install guidance when mmdc is missing.",
            "Render with the Mermaid Ink HTTP API only. Diagram content is sent to the configured host."
          ],
          "default": "auto",
          "description": "How Mermaid diagrams are rendered. The API fallback sends diagram content to mermaid.ink unless a self-hosted Mermaid Ink URL is configured."
        },
        "mdocxConverter.mermaidApiUrl": {
          "type": "string",
          "default": "https://mermaid.ink",
          "description": "Base URL of the Mermaid Ink service used when mdocxConverter.mermaidRenderer allows the API fallback. Point this at a self-hosted instance to keep diagram content local."
        },
```

- [ ] **Step 2: 扩展 ExportSettings 与 readSettings**

`ExportSettings` 接口加入：

```ts
    mermaidRenderer: 'auto' | 'local' | 'api';
    mermaidApiUrl: string;
```

`readSettings` 里加入：

```ts
        mermaidRenderer: readConfigValue<'auto' | 'local' | 'api'>(config, legacyConfig, 'mermaidRenderer', 'auto'),
        mermaidApiUrl: readConfigValue(config, legacyConfig, 'mermaidApiUrl', 'https://mermaid.ink').trim() || 'https://mermaid.ink',
```

- [ ] **Step 3: 改造 prepareMarkdown**

把 `src/extension.ts` 的 `prepareMarkdown` 整体替换为：

```ts
async function prepareMarkdown(
    markdownPath: string,
    markdownText: string,
    settings: ExportSettings,
    outputChannel: vscode.OutputChannel,
    onProgress?: (completed: number, total: number) => void
): Promise<PreparedMarkdown> {
    const blocks = parseMermaidBlocks(markdownText);
    if (blocks.length === 0) {
        outputChannel.appendLine('No Mermaid blocks found.');
        return {
            markdownPath,
            mermaidCount: 0
        };
    }

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdocx-converter-'));
    const assetsDir = path.join(tempDir, 'mermaid-assets');
    await fsp.mkdir(assetsDir, { recursive: true });

    let localMermaid: ResolvedExecutable | undefined;
    if (settings.mermaidRenderer !== 'api') {
        localMermaid = await resolveMermaidCli(settings.mermaidCliPath, markdownPath);
        if (localMermaid) {
            outputChannel.appendLine(`Using Mermaid CLI: ${localMermaid.command}`);
            outputChannel.appendLine(`Mermaid CLI version: ${localMermaid.versionLine}`);
        }
    }

    if (!localMermaid && settings.mermaidRenderer === 'local') {
        throw new UserFacingError(
            'Mermaid CLI was not found, but this Markdown file contains mermaid code fences. Install with "npm install -g @mermaid-js/mermaid-cli" or set mdocxConverter.mermaidCliPath.'
        );
    }

    if (!localMermaid && settings.mermaidRenderer === 'auto') {
        outputChannel.appendLine('Mermaid CLI unavailable, falling back to the Mermaid Ink API.');
    }

    const deadline = Date.now() + MERMAID_TOTAL_BUDGET_MS;
    let completed = 0;
    const markCompleted = () => {
        completed += 1;
        onProgress?.(completed, blocks.length);
    };

    const rendered = await mapWithConcurrency(blocks, 4, async (block, index) => {
        const fileName = `diagram-${index + 1}.${settings.mermaidOutputFormat}`;
        const outputPath = path.join(assetsDir, fileName);

        if (localMermaid) {
            const inputPath = path.join(assetsDir, `diagram-${index + 1}.mmd`);
            await fsp.writeFile(inputPath, block.code.trim(), 'utf8');
            try {
                await runExecutable(
                    localMermaid.command,
                    ['-i', inputPath, '-o', outputPath, '-b', 'transparent'],
                    { shell: localMermaid.useShell, cwd: path.dirname(markdownPath) }
                );
                markCompleted();
                return { fileName, succeeded: true };
            } catch (error) {
                outputChannel.appendLine(`Mermaid CLI failed for diagram ${index + 1}: ${getErrorMessage(error)}`);
                if (settings.mermaidRenderer === 'local') {
                    throw error;
                }
            }
        }

        if (settings.mermaidRenderer !== 'local' && Date.now() < deadline) {
            try {
                const image = await renderMermaidWithRetry(block.code, { apiUrl: settings.mermaidApiUrl });
                await fsp.writeFile(outputPath, image);
                outputChannel.appendLine(`Mermaid Ink API fallback used — diagram content was sent to ${settings.mermaidApiUrl}`);
                markCompleted();
                return { fileName, succeeded: true };
            } catch (error) {
                outputChannel.appendLine(`Mermaid Ink API failed for diagram ${index + 1}: ${getErrorMessage(error)}`);
            }
        }

        markCompleted();
        return { fileName, succeeded: false };
    });

    let processedMarkdown = '';
    let lastIndex = 0;

    blocks.forEach((block, index) => {
        processedMarkdown += markdownText.slice(lastIndex, block.start);
        const result = rendered[index];
        if (result.succeeded) {
            const relativeDiagramPath = `./mermaid-assets/${result.fileName}`.replace(/\\/g, '/');
            processedMarkdown = ensureTrailingBlankLine(processedMarkdown);
            processedMarkdown += `![Mermaid Diagram ${index + 1}](${relativeDiagramPath})\n\n`;
        } else {
            processedMarkdown = ensureTrailingBlankLine(processedMarkdown);
            processedMarkdown += '```mermaid\n' + block.code + '\n```\n\n';
        }
        lastIndex = block.end;
    });

    processedMarkdown += markdownText.slice(lastIndex);

    const preparedMarkdownPath = path.join(tempDir, path.basename(markdownPath));
    await fsp.writeFile(preparedMarkdownPath, processedMarkdown, 'utf8');

    const failedCount = rendered.filter((item) => !item.succeeded).length;
    if (failedCount > 0) {
        outputChannel.appendLine(`${failedCount} of ${blocks.length} Mermaid diagrams could not be rendered and were kept as code blocks.`);
    }

    return {
        markdownPath: preparedMarkdownPath,
        tempDir,
        mermaidCount: blocks.length
    };
}
```

import 段加入：

```ts
import { mapWithConcurrency, MERMAID_TOTAL_BUDGET_MS, parseMermaidBlocks, renderMermaidWithRetry } from './mermaid';
```

删除 `MERMAID_BLOCK_REGEX` 常量（已搬到 `src/mermaid.ts`）。

- [ ] **Step 4: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add src/extension.ts package.json
git commit -m "feat: fall back to the Mermaid Ink API and keep failed diagrams as code blocks"
```

---

### Task 9: 文档标题元数据

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: 增加设置**

`package.json` 加入：

```json
        "mdocxConverter.documentTitle": {
          "type": "string",
          "default": "",
          "description": "Document title written into the DOCX core properties. Leave empty to use the first heading in the document, or the file name when the document has no heading."
        },
```

- [ ] **Step 2: 读取设置**

`ExportSettings` 加入 `documentTitle: string;`，`readSettings` 加入：

```ts
        documentTitle: readConfigValue(config, legacyConfig, 'documentTitle', '').trim(),
```

- [ ] **Step 3: 写入 metadata**

在 `src/extension.ts` 的 import 段加入 `import { resolveDocumentTitle } from './document';`（Task 2 为了启用 `noUnusedLocals` 已把它移除），然后在 `runExport` 中，`prepareMarkdown` 调用之后、`runPandoc` 之前，解析标题：

```ts
        const documentTitle = resolveDocumentTitle(markdownText, settings.documentTitle, markdownUri.fsPath);
        outputChannel.appendLine(`Document title: ${documentTitle}`);
```

在 `runPandoc` 的 `buildPandocMetadata(settings)` 之后，把标题加进 metadata：

```ts
    const metadata = buildPandocMetadata(settings);
    metadata.title = options.documentTitle;
```

为此在 `runPandoc` 的参数接口里加 `documentTitle: string;`，并在调用处传入 `documentTitle`。

- [ ] **Step 4: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 5: 手工验证**

Run:
```bash
printf '# 我的标题\n\n正文。\n' > /tmp/title.md
pandoc /tmp/title.md -o /tmp/title.docx --reference-doc multi-templates/reference_chinese_academic.docx --metadata title=我的标题
python -c "import zipfile;print(zipfile.ZipFile('/tmp/title.docx').read('docProps/core.xml').decode('utf8'))"
```
Expected: `core.xml` 里出现 `<dc:title>我的标题</dc:title>`

- [ ] **Step 6: 提交**

```bash
git add src/extension.ts package.json
git commit -m "feat: write the document title into the DOCX core properties"
```

---

### Task 10: 新增命令（official / thesis 导出 + 独立 Mermaid 渲染）

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: 注册新命令**

`src/extension.ts` 顶部常量区加入：

```ts
const EXPORT_OFFICIAL_DOCUMENT_COMMAND_ID = 'mdocxConverter.exportOfficialDocument';
const EXPORT_THESIS_COMMAND_ID = 'mdocxConverter.exportThesis';
const RENDER_MERMAID_COMMAND_ID = 'mdocxConverter.renderMermaidToImage';
```

`activate` 里加入：

```ts
    const exportOfficialDocumentDisposable = vscode.commands.registerCommand(EXPORT_OFFICIAL_DOCUMENT_COMMAND_ID, async (uri?: vscode.Uri) => {
        await runExport(uri, outputChannel, context.extensionPath, {
            styleProfile: 'official',
            referenceLanguage: 'auto'
        });
    });
    const exportThesisDisposable = vscode.commands.registerCommand(EXPORT_THESIS_COMMAND_ID, async (uri?: vscode.Uri) => {
        await runExport(uri, outputChannel, context.extensionPath, {
            styleProfile: 'thesis',
            referenceLanguage: 'auto'
        });
    });
    const renderMermaidDisposable = vscode.commands.registerCommand(RENDER_MERMAID_COMMAND_ID, async () => {
        await renderMermaidToImage(outputChannel, context);
    });
```

并把三个 disposable 加进 `context.subscriptions.push(...)`。

- [ ] **Step 2: 实现独立 Mermaid 渲染**

在 `src/extension.ts` 加入：

```ts
async function renderMermaidToImage(outputChannel: vscode.OutputChannel, context: vscode.ExtensionContext): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showErrorMessage('Open a Markdown file to render a Mermaid diagram.');
        return;
    }

    const document = editor.document;
    const selection = editor.selection;
    let code: string;
    let insertRange: vscode.Range;

    if (!selection.isEmpty) {
        code = document.getText(selection);
        insertRange = new vscode.Range(selection.end, selection.end);
    } else {
        const block = findMermaidBlockAtPosition(document.getText(), document.offsetAt(selection.active));
        if (!block) {
            void vscode.window.showErrorMessage('Select a Mermaid code block or place the cursor inside one.');
            return;
        }
        code = block.code;
        insertRange = new vscode.Range(document.positionAt(block.end), document.positionAt(block.end));
    }

    const settings = readSettings(document.uri);
    const outputDirectory = path.join(path.dirname(document.uri.fsPath), 'mermaid-images');
    await fsp.mkdir(outputDirectory, { recursive: true });

    const fileName = `mermaid-${formatTimestamp(new Date())}.${settings.mermaidOutputFormat}`;
    const outputPath = path.join(outputDirectory, fileName);

    try {
        const image = await renderDiagramToFile(code, outputPath, settings, outputChannel, context);
        if (!image) {
            return;
        }

        const relativePath = `mermaid-images/${fileName}`.replace(/\\/g, '/');
        await editor.edit((builder) => {
            builder.insert(insertRange, `\n![Mermaid Diagram](${relativePath})\n`);
        });

        outputChannel.appendLine(`Mermaid diagram rendered: ${outputPath}`);
        void vscode.window.showInformationMessage(`Mermaid diagram rendered: ${fileName}`);
    } catch (error) {
        const message = getErrorMessage(error);
        outputChannel.appendLine(`Mermaid render failed: ${message}`);
        void vscode.window.showErrorMessage(message);
    }
}

function formatTimestamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
        + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function renderDiagramToFile(
    code: string,
    outputPath: string,
    settings: ExportSettings,
    outputChannel: vscode.OutputChannel,
    context: vscode.ExtensionContext
): Promise<boolean> {
    if (settings.mermaidRenderer !== 'api') {
        const localMermaid = await resolveMermaidCli(settings.mermaidCliPath, path.dirname(outputPath));
        if (localMermaid) {
            const inputPath = `${outputPath}.mmd`;
            await fsp.writeFile(inputPath, code.trim(), 'utf8');
            await runExecutable(localMermaid.command, ['-i', inputPath, '-o', outputPath, '-b', 'transparent'], {
                shell: localMermaid.useShell,
                cwd: path.dirname(outputPath)
            });
            await fsp.rm(inputPath, { force: true });
            return true;
        }

        if (settings.mermaidRenderer === 'local') {
            throw new UserFacingError('Mermaid CLI was not found. Install with "npm install -g @mermaid-js/mermaid-cli" or set mdocxConverter.mermaidCliPath.');
        }

        outputChannel.appendLine('Mermaid CLI unavailable, falling back to the Mermaid Ink API.');
    }

    const image = await renderMermaidWithRetry(code, { apiUrl: settings.mermaidApiUrl });
    await fsp.writeFile(outputPath, image);
    outputChannel.appendLine(`Mermaid Ink API fallback used — diagram content was sent to ${settings.mermaidApiUrl}`);
    await notifyMermaidApiUsage(context);
    return true;
}
```

`findMermaidBlockAtPosition` 放进 `src/mermaid.ts`（和 `parseMermaidBlocks` 是同一类职责 —— 代码块定位；`src/document.ts` 只管文档元数据）：

```ts
export interface MermaidBlockRange {
    code: string;
    start: number;
    end: number;
}

export function findMermaidBlockAtPosition(markdownText: string, offset: number): MermaidBlockRange | undefined {
    const regex = /^```mermaid[^\n]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gim;
    let match = regex.exec(markdownText);
    while (match) {
        const start = match.index;
        const end = start + match[0].length;
        if (offset >= start && offset <= end) {
            return { code: match[1], start, end };
        }
        match = regex.exec(markdownText);
    }

    return undefined;
}
```

`src/document.ts` 的 import 段无需改动。

- [ ] **Step 2b: 给 `findMermaidBlockAtPosition` 补测试**

在 `test/unit/mermaid.test.js` 末尾追加：

```js
const { findMermaidBlockAtPosition } = require('../../out/mermaid.js');

test('findMermaidBlockAtPosition locates the block under the cursor', () => {
    const text = 'intro\n```mermaid\ngraph TD; A-->B\n```\ntail';
    const start = text.indexOf('```mermaid');
    const found = findMermaidBlockAtPosition(text, start + 3);
    assert.ok(found);
    assert.equal(found.code, 'graph TD; A-->B');
});

test('findMermaidBlockAtPosition returns undefined outside a block', () => {
    assert.equal(findMermaidBlockAtPosition('# Title\n\ntext', 3), undefined);
});
```

Run: `npm test`
Expected: PASS

- [ ] **Step 3: 远程渲染的用户告知**

在 `src/extension.ts` 加入：

```ts
async function notifyMermaidApiUsage(context: vscode.ExtensionContext): Promise<void> {
    const noticeKey = 'mdocxConverter.mermaidApiNoticeShown';
    if (context.globalState.get(noticeKey)) {
        return;
    }

    const choice = await vscode.window.showInformationMessage(
        'Mermaid diagrams were rendered by mermaid.ink — the diagram content was sent to an external service.',
        'Open Settings'
    );

    await context.globalState.update(noticeKey, true);
    if (choice === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'mdocxConverter.mermaidRenderer');
    }
}
```

在 `prepareMarkdown` 的 API 成功分支之后也调用一次 `notifyMermaidApiUsage(context)`（需要把 `context` 传进 `prepareMarkdown`；为最小改动，可在 `runExport` 里于 `prepareMarkdown` 返回后判断是否发生过 API 回退——为此在 `PreparedMarkdown` 上加 `usedApiFallback: boolean`）。

- [ ] **Step 4: package.json 声明命令与菜单**

`contributes.commands` 加入：

```json
      {
        "command": "mdocxConverter.exportOfficialDocument",
        "title": "Export as Official Document (MDocx)",
        "shortTitle": "Official Document",
        "category": "MD2Docx Converter"
      },
      {
        "command": "mdocxConverter.exportThesis",
        "title": "Export as Thesis (MDocx)",
        "shortTitle": "Thesis",
        "category": "MD2Docx Converter"
      },
      {
        "command": "mdocxConverter.renderMermaidToImage",
        "title": "Render Mermaid Diagram to Image (MDocx)",
        "shortTitle": "Render Mermaid",
        "category": "MD2Docx Converter"
      }
```

`activationEvents` 加入三个 `onCommand:` 条目。

`contributes.menus["mdocxConverter.exportSubmenu"]` 加入：

```json
        {
          "command": "mdocxConverter.exportOfficialDocument",
          "group": "1_profiles@40"
        },
        {
          "command": "mdocxConverter.exportThesis",
          "group": "1_profiles@50"
        }
```

`contributes.menus["editor/context"]` 加入：

```json
        {
          "command": "mdocxConverter.renderMermaidToImage",
          "group": "z_mdocx@96",
          "when": "editorLangId == markdown"
        }
```

`contributes.menus.commandPalette` 加入三个新命令。

- [ ] **Step 5: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 6: 提交**

```bash
git add src/extension.ts src/document.ts package.json
git commit -m "feat: add official/thesis export commands and a standalone mermaid renderer"
```

---

### Task 11: 导出进度与取消

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 引入进度与取消令牌**

`src/extension.ts` 顶部 import 加入：

```ts
import type { CancellationToken } from 'vscode';
```

- [ ] **Step 2: runExport 包一层 withProgress**

把 `runExport` 主体改为在 `vscode.window.withProgress` 内执行。关键改动：

```ts
async function runExport(
    uri: vscode.Uri | undefined,
    outputChannel: vscode.OutputChannel,
    extensionPath: string,
    exportOverrides?: ExportOverrides
): Promise<void> {
    const markdownUri = getMarkdownUri(uri);
    if (!markdownUri) {
        void vscode.window.showErrorMessage('Open a Markdown file or right-click a .md file to export it.');
        return;
    }

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`Starting export for ${markdownUri.fsPath}`);

    let prepared: PreparedMarkdown | undefined;

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Exporting Markdown to DOCX',
                cancellable: true
            },
            async (progress, token) => {
                const settings = readSettings(markdownUri, exportOverrides);
                const outputPath = await resolveOutputPath(markdownUri, settings.outputDirectory);
                const markdownText = await fsp.readFile(markdownUri.fsPath, 'utf8');
                const resolvedLanguage = resolveReferenceLanguage(markdownText, settings.referenceLanguage);
                const referenceDocx = await resolveReferenceDocx(markdownUri, settings.referenceDocx, resolvedLanguage, settings.styleProfile, extensionPath);

                logMissingLocalImages(markdownUri.fsPath, markdownText, outputChannel);

                progress.report({ message: 'Preparing Markdown' });
                prepared = await prepareMarkdown(markdownUri.fsPath, markdownText, settings, outputChannel, (completed, total) => {
                    progress.report({ message: `Rendering Mermaid diagrams (${completed}/${total})` });
                }, token);

                token.throwIfCancellationRequested();

                const pandoc = await requirePandoc(settings.pandocPath);
                outputChannel.appendLine(`Using Pandoc: ${pandoc.command}`);
                outputChannel.appendLine(`Pandoc version: ${pandoc.versionLine}`);

                if (referenceDocx) {
                    outputChannel.appendLine(`Using reference DOCX: ${referenceDocx}`);
                    outputChannel.appendLine(`Reference language mode: ${settings.referenceLanguage} -> ${resolvedLanguage}`);
                } else {
                    outputChannel.appendLine('No reference DOCX found. Exporting with Pandoc defaults.');
                }

                progress.report({ message: 'Running Pandoc' });
                await runPandoc({
                    pandoc,
                    sourceMarkdownPath: prepared.markdownPath,
                    originalMarkdownPath: markdownUri.fsPath,
                    outputPath,
                    referenceDocx,
                    settings,
                    documentTitle: resolveDocumentTitle(markdownText, settings.documentTitle, markdownUri.fsPath),
                    tempDir: prepared.tempDir,
                    outputChannel,
                    token
                });

                progress.report({ message: 'Applying styles' });
                outputChannel.appendLine(`Export completed: ${outputPath}`);
                void vscode.window.showInformationMessage(`DOCX exported successfully: ${path.basename(outputPath)}`);

                if (settings.openAfterExport) {
                    await openExportedDocx(outputPath, outputChannel);
                }
            }
        );
    } catch (error) {
        const message = getErrorMessage(error);
        outputChannel.appendLine(`Export failed: ${message}`);
        void vscode.window.showErrorMessage(message);
    } finally {
        if (prepared?.tempDir) {
            const settings = readSettings(markdownUri, exportOverrides);
            if (!settings.keepIntermediateFiles) {
                await fsp.rm(prepared.tempDir, { recursive: true, force: true });
            } else {
                outputChannel.appendLine(`Kept intermediate files in: ${prepared.tempDir}`);
            }
        }
    }
}
```

- [ ] **Step 3: runPandoc 支持取消**

`runPandoc` 的参数接口加 `token?: CancellationToken;`，并把 `runExecutable` 换成可中止的调用。在 `runExecutable` 里加一个可选的 `token` 参数：

```ts
async function runExecutable(
    command: string,
    args: string[],
    options: { cwd?: string; shell?: boolean; maxBuffer?: number; token?: CancellationToken } = {}
): Promise<{ stdout: string; stderr: string }> {
    ...
}
```

`execExecutable` 内部改用 `spawn` 以便拿到 child 句柄：

```ts
function execExecutable(
    command: string,
    args: string[],
    options: { cwd?: string; shell?: boolean; maxBuffer?: number; token?: CancellationToken } = {}
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            shell: options.shell !== undefined ? options.shell : shouldRunThroughShell(command),
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';
        const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024;

        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            if (stdout.length > maxBuffer) {
                child.kill();
            }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
            if (stderr.length > maxBuffer) {
                child.kill();
            }
        });

        const cancellation = options.token?.onCancellationRequested(() => {
            child.kill();
        });

        child.on('error', (error) => {
            cancellation?.dispose();
            reject(error);
        });

        child.on('close', (code) => {
            cancellation?.dispose();
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }

            const error = new Error(`Process exited with code ${code}`) as Error & { stdout?: string; stderr?: string };
            error.stdout = stdout;
            error.stderr = stderr;
            reject(error);
        });
    });
}
```

在 `runPandoc` 的 `try` 块开头插入：

```ts
        options.token?.throwIfCancellationRequested();
```

- [ ] **Step 4: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add src/extension.ts
git commit -m "feat: show export progress and allow cancelling a running export"
```

---

### Task 12: 扩展 checkEnvironment

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 扩展诊断输出**

把 `checkEnvironment` 替换为：

```ts
async function checkEnvironment(uri: vscode.Uri | undefined, outputChannel: vscode.OutputChannel): Promise<void> {
    const markdownUri = getMarkdownUri(uri) ?? vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd());
    const settings = readSettings(markdownUri);

    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine('Checking mdocx-converter export environment...');

    const pandoc = await resolvePandoc(settings.pandocPath);
    if (pandoc) {
        outputChannel.appendLine(`OK Pandoc: ${pandoc.command}`);
        outputChannel.appendLine(`   ${pandoc.versionLine}`);
    } else {
        outputChannel.appendLine('MISSING Pandoc');
        outputChannel.appendLine(`   ${getPandocInstallHelp()}`);
    }

    const mermaid = await resolveMermaidCli(settings.mermaidCliPath, markdownUri.fsPath);
    if (mermaid) {
        outputChannel.appendLine(`OK Mermaid CLI: ${mermaid.command}`);
        outputChannel.appendLine(`   ${mermaid.versionLine}`);
    } else {
        outputChannel.appendLine('MISSING Mermaid CLI');
        outputChannel.appendLine('   Required only for ```mermaid code fences. Install with: npm install -g @mermaid-js/mermaid-cli');
        outputChannel.appendLine('   Or set mdocxConverter.mermaidCliPath.');
    }

    outputChannel.appendLine(`Mermaid renderer: ${settings.mermaidRenderer}`);

    if (settings.mermaidRenderer !== 'local') {
        const reachable = await checkMermaidApiReachable(settings.mermaidApiUrl);
        outputChannel.appendLine(reachable
            ? `OK Mermaid Ink API: ${settings.mermaidApiUrl}`
            : `UNREACHABLE Mermaid Ink API: ${settings.mermaidApiUrl}`);
    }

    const templateCount = countBundledTemplates(extensionPath);
    outputChannel.appendLine(`Bundled templates: ${templateCount}`);

    outputChannel.appendLine(`Active style profile: ${settings.styleProfile}`);

    if (pandoc && (mermaid || settings.mermaidRenderer !== 'local')) {
        void vscode.window.showInformationMessage('mdocx-converter export environment looks ready.');
    } else if (pandoc) {
        void vscode.window.showWarningMessage('Pandoc is ready. Mermaid CLI is missing, so Mermaid diagrams will not export until mmdc is installed.');
    } else {
        void vscode.window.showWarningMessage('Pandoc is missing. Install Pandoc before exporting DOCX files.');
    }
}

async function checkMermaidApiReachable(apiUrl: string): Promise<boolean> {
    try {
        await renderMermaidViaInk('graph TD; A-->B', { apiUrl, timeoutMs: 10000, maxAttempts: 1 });
        return true;
    } catch {
        return false;
    }
}

function countBundledTemplates(extensionPath: string): number {
    const templateDir = path.join(extensionPath, 'multi-templates');
    if (!fs.existsSync(templateDir)) {
        return 0;
    }

    return fs.readdirSync(templateDir).filter((name) => name.endsWith('.docx')).length;
}
```

`checkEnvironment` 需要拿到 `extensionPath`，因此签名改为 `checkEnvironment(uri, outputChannel, extensionPath)`，并在 `activate` 里传入 `context.extensionPath`。

import 段加入 `renderMermaidViaInk`。

- [ ] **Step 2: 编译校验**

Run: `npm run compile`
Expected: 无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add src/extension.ts
git commit -m "feat: report renderer, API reachability and template count in checkEnvironment"
```

---

### Task 13: 端到端测试脚本重写

**Files:**
- Create: `test/e2e/run.js`
- Delete: `test_full_pipeline.js`

- [ ] **Step 1: 删除旧脚本**

```bash
git rm test_full_pipeline.js
```

- [ ] **Step 2: 写新脚本**

`test/e2e/run.js`：

```js
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const AdmZip = require('adm-zip');

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.join(__dirname, '..', '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'multi-templates');
const PROFILES = ['academic', 'business', 'technical', 'official', 'thesis'];

function run(command, args, options = {}) {
    return execFileAsync(command, args, {
        cwd: options.cwd,
        shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
        windowsHide: true
    });
}

async function pandocVersion() {
    const { stdout } = await run('pandoc', ['--version']);
    return stdout.split('\n')[0].trim();
}

async function exportOne(profile, language, workDir) {
    const markdownPath = path.join(workDir, 'sample.md');
    const outputPath = path.join(workDir, `sample-${profile}-${language}.docx`);
    const referenceDocx = path.join(TEMPLATE_DIR, `reference_${language}_${profile}.docx`);

    await run('pandoc', [
        markdownPath,
        '--from', 'gfm+raw_html',
        '--to', 'docx',
        '--output', outputPath,
        '--reference-doc', referenceDocx
    ], { cwd: workDir });

    const zip = new AdmZip(outputPath);
    const document = zip.readAsText('word/document.xml');
    const sectPr = document.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)[0];

    if (/w:num="2"/.test(sectPr)) {
        throw new Error(`${profile}/${language} produced a two-column document`);
    }
    if (!/<w:pgSz w:w="11906" w:h="16838"/.test(sectPr)) {
        throw new Error(`${profile}/${language} is not A4`);
    }
    if (!zip.getEntry('word/footer1.xml')) {
        throw new Error(`${profile}/${language} lost the page-number footer`);
    }

    return outputPath;
}

async function main() {
    const markdown = '# Sample Title\n\nSome body text for the export test.\n\n## Section\n\nMore text.\n';
    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mdocx-e2e-'));

    try {
        console.log('Pandoc:', await pandocVersion());
        await fsp.writeFile(path.join(workDir, 'sample.md'), markdown, 'utf8');

        for (const profile of PROFILES) {
            for (const language of ['english', 'chinese']) {
                const output = await exportOne(profile, language, workDir);
                console.log(`OK ${profile}/${language} -> ${path.basename(output)}`);
            }
        }

        console.log('\nAll e2e exports succeeded.');
    } finally {
        await fsp.rm(workDir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error('E2E FAILED:', error.message);
    process.exit(1);
});
```

- [ ] **Step 3: 运行**

Run: `npm run test:e2e`
Expected: 输出 10 行 `OK <profile>/<language>` 与 `All e2e exports succeeded.`

- [ ] **Step 4: 提交**

```bash
git add test/e2e/run.js test_full_pipeline.js
git commit -m "test: replace the stale pipeline script with a per-profile e2e export check"
```

---

### Task 14: 文档与版本

**Files:**
- Modify: `package.json`（版本号、`styleProfile` 枚举）
- Modify: `CLAUDE.md`（根）
- Modify: `VSC-plugin-MD2Docx-Converter/CLAUDE.md`
- Modify: `VSC-plugin-MD2Docx-Converter/README.md`
- Modify: `dify-plugin-MD2Docx/CLAUDE.md`
- Modify: `dify-plugin-MD2Docx/README.md`

- [ ] **Step 1: package.json 的 styleProfile 枚举**

把 `mdocxConverter.styleProfile` 的 `enum` 与 `enumDescriptions` 改为：

```json
          "enum": [
            "template",
            "academic",
            "business",
            "technical",
            "official",
            "thesis"
          ],
          "enumDescriptions": [
            "Template only: use the selected reference DOCX without extra metadata overrides.",
            "Academic paper: 12 pt, 1.5 line spacing, Times New Roman / SimSun body, SimHei headings.",
            "Business report: 11 pt, 1.5 line spacing, Arial / Microsoft YaHei body and headings.",
            "Technical document: 11 pt, 1.35 line spacing, Arial body, Consolas code styles.",
            "Official document (GB/T 9704): 16 pt FangSong body, 29 pt fixed line height, 37/35/28/26 mm margins.",
            "Thesis (GB/T 7713): 12 pt body, 22/16/14 pt headings, 30 mm margins."
          ],
```

- [ ] **Step 2: 版本号**

`package.json` 的 `"version"` 改为 `"0.3.0"`。

- [ ] **Step 3: 根 CLAUDE.md**

模板说明段落改为：

```markdown
Templates are at `multi-templates/` under each subdirectory (10 files: academic/technical/business/official/thesis x Chinese/English; the `template` profile reuses academic). Both subdirectories carry the identical set.

The VS Code extension owns the template generator (`VSC-plugin-MD2Docx-Converter/scripts/build-templates.js`) — edit the style table in `src/profiles.ts`, run `npm run build:templates`, then `bash scripts/sync-templates.sh` to copy the result into the Dify plugin.
```

并把「⚠️ **模板同步 note:**」整段替换为上面的说明。

- [ ] **Step 4: VSC 插件 CLAUDE.md**

- Commands 段补上：

```bash
npm test              # compile + node:test unit suite
npm run test:e2e      # per-profile export check (needs pandoc)
npm run build:templates   # regenerate multi-templates/ from src/profiles.ts
```

- Architecture 段补上模块划分小节：

```markdown
### Source layout

| Module | Contents |
|---|---|
| `src/extension.ts` | Command wiring, settings, pandoc invocation, adm-zip style overrides, progress UI |
| `src/profiles.ts` | `PROFILE_PRESETS` — the single source of truth for every style profile; `TEMPLATE_LAYOUT` for the template generator |
| `src/language.ts` | CJK/Latin language detection |
| `src/templates.ts` | Bundled template map and candidate paths |
| `src/mermaid.ts` | Mermaid block parsing, pako encoding, Mermaid Ink API client |
| `src/document.ts` | Document title extraction, filename sanitisation |

Only `src/extension.ts` may import `vscode` — the other modules are pure so `node --test` can load them directly.
```

- Style system 段改写为：

```markdown
### Style system (two layers)

**Layer 1 — Pandoc metadata** (`buildPandocMetadata`): Reads `PROFILE_PRESETS[profile].metadata` and applies per-setting overrides.

**Layer 2 — DOCX XML overrides** (`applyDocxStyleOverrides`): After pandoc finishes, opens the .docx via `adm-zip` and rewrites `word/styles.xml` and `word/document.xml`. Font names are split into `asciiFont` (w:ascii/w:hAnsi/w:cs) and `eastAsiaFont` (w:eastAsia) so English documents use a Latin face and Chinese text keeps its own.

Both layers read the same `PROFILE_PRESETS` entry, so they cannot drift.
```

- 预设表用第 3 节 Task 3 的数据。

- [ ] **Step 5: VSC README**

补上 Features 段的预设表、Commands 表、Settings 表，并加一节 Breaking changes：

```markdown
### Changes in 0.3.0

- English documents now use Times New Roman (or Arial) for body text instead of SimSun. Fonts are split into Latin and East-Asian slots.
- `business` line spacing changed from 1.25 to 1.5; `technical` from 1.2 to 1.35 — matching the Dify plugin.
- All bundled templates were regenerated: single column, A4, standard pandoc style ids, first-line indent, and a centred page number. The previous English templates were two-column with journal-style heading formatting.
```

- [ ] **Step 6: Dify 侧文档**

`dify-plugin-MD2Docx/CLAUDE.md` 的模板说明改为：

```markdown
multi-templates/           # 10 reference.docx (5 profiles x 2 languages) — copied from the VSC plugin by scripts/sync-templates.sh
```

并在模板解析一节说明 `thesis` 指向独立模板。

- [ ] **Step 6b: 加一个 CI workflow**

仓库目前没有任何 GitHub Actions workflow —— 测试只在本机跑就没有意义。新建 `.github/workflows/vsc-plugin-tests.yml`（在仓库根目录，不在插件目录里）：

```yaml
name: VS Code plugin tests

on:
  push:
    paths:
      - 'VSC-plugin-MD2Docx-Converter/**'
  pull_request:
    paths:
      - 'VSC-plugin-MD2Docx-Converter/**'

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: VSC-plugin-MD2Docx-Converter
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm ci
      - run: npm test
```

Node 版本必须是 24 —— `node --test` 的 glob 支持需要 Node 21+。

- [ ] **Step 7: 全量校验**

Run:
```bash
npm run compile
npm test
npm run build:templates
git status --short
```
Expected: 编译无错误、测试全绿、模板生成无差异（`git status` 不显示 multi-templates 改动）

- [ ] **Step 8: 提交**

```bash
git add package.json CLAUDE.md VSC-plugin-MD2Docx-Converter/CLAUDE.md VSC-plugin-MD2Docx-Converter/README.md dify-plugin-MD2Docx/CLAUDE.md dify-plugin-MD2Docx/README.md .github/workflows/vsc-plugin-tests.yml
git commit -m "docs: document the new profiles, commands, settings and template pipeline"
```

---

## 自查清单

- [ ] spec 的每一节都有对应任务：模块划分 → Task 2/4；单一数据源 → Task 3；预设表 → Task 3；命令 → Task 10；模板重建 → Task 5；Dify 同步 → Task 6；Mermaid → Task 7/8；标题 → Task 9；进度 → Task 11；诊断 → Task 12；测试 → Task 1/13；文档 → Task 14
- [ ] 无 TBD / TODO / “similar to Task N” 占位
- [ ] 类型名一致：`FontPair`、`ProfilePreset`、`StyleProfile`、`MermaidBlock`、`DocxStyleOverride`
- [ ] `PROFILE_PRESETS` 的字段名在生成器、扩展、测试三处一致
- [ ] 模板文件清单在三处一致（生成器、模板映射、同步脚本）：10 个
