# CLAUDE.md

This extension lives in the `VSC-plugin-MD2Docx-Converter/` directory of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo. The sibling `dify-plugin-MD2Docx/` directory contains a Dify Tool plugin port of the same pipeline.

## Commands

```bash
npm install           # install dependencies (typescript, adm-zip, etc.)
npm run compile       # tsc -p ./  — compiles src/ to out/
npm run watch         # tsc -watch -p ./
npm run package       # vsce package --allow-missing-repository  — creates .vsix
npm test              # compile + node:test unit suite (needs Node >= 22 for --test globs)
```

Press `F5` in VS Code to launch an Extension Development Host for manual testing.

## Testing

Unit tests live in `test/unit/*.test.js` and run on Node's built-in `node:test` runner — no test framework dependency.

- The test glob is `test/unit/**/*.test.js`, so **every test file must be named `*.test.js`** or it will be silently skipped.
- `npm test` compiles `src/` to `out/` first, then the tests `require()` the compiled output (e.g. `require('../../out/document.js')`). `test/` is not part of the TypeScript build.
- A glob that matches nothing exits 0, so a renamed test file looks like a passing run. If `npm test` reports zero tests, the naming convention was broken.
- Node 18/20 lack `--test` glob support; use Node >= 22.

`test_full_pipeline.js` is a **manual integration script** — it spawns the real `pandoc` and `mmdc` binaries against a sample Markdown file. It is **not** wired into the repo CI (`.github/workflows/ci.yml` covers only the Dify plugin's pytest suite and `scripts/sync-templates.sh --check`) because it needs pandoc and mmdc installed on the runner.

## Architecture

This is a **VS Code extension** that exports Markdown files to DOCX. The extension host entry point lives in `src/extension.ts` (~1200 lines); pure helper modules are being split out beside it — currently `src/document.ts` (document title and filename sanitising), `src/language.ts` (reference-language detection and normalisation), `src/profiles.ts` (style presets and the pure resolution helpers) and `src/templates.ts` (bundled reference DOCX paths). Everything compiles to `out/` via TypeScript.

**Only `src/extension.ts` may import `vscode`.** Every other module must stay pure so that `node --test` can load the compiled output directly outside the Extension Host.

### Conversion pipeline

```
Markdown file
  │
  ├─ 1. Mermaid preprocessing: regex-extract ```mermaid blocks → mmdc → PNG/SVG
  │     Replaces each fenced block with ![Mermaid Diagram N](path/to/rendered.png)
  │     Produces a temp Markdown file in os.tmpdir()
  │
  ├─ 2. Pandoc: gfm+raw_html → docx via --reference-doc (template)
  │     Metadata injected via --metadata (mainfont, CJKmainfont, fontsize, linestretch, monofont)
  │     --resource-path set to both the original Markdown dir and the temp dir
  │     NOT sandboxed — local image paths and remote URLs still resolve
  │
  └─ 3. DOCX style overrides: adm-zip opens the generated .docx
        Edits word/styles.xml  — font, size, spacing, color, shading per style ID
        Edits word/document.xml — page margins (w:pgMar)
```

### Command registration (5 commands)

| Command ID | Trigger |
|---|---|
| `mdocxConverter.exportToDocx` | Command palette (generic export, uses current `styleProfile` setting) |
| `mdocxConverter.exportAcademicPaper` | Right-click submenu — forces `styleProfile=academic, referenceLanguage=auto` |
| `mdocxConverter.exportTechnicalDocument` | Right-click submenu — forces `styleProfile=technical, referenceLanguage=auto` |
| `mdocxConverter.exportBusinessReport` | Right-click submenu — forces `styleProfile=business, referenceLanguage=auto` |
| `mdocxConverter.checkEnvironment` | Checks pandoc and mmdc availability, prints versions |

The 3 submenu commands override `styleProfile` and `referenceLanguage` regardless of user settings. This is the primary UX: right-click an `.md` file → choose document type → get auto language detection + template selection.

### Template resolution order

1. `mdocxConverter.referenceDocx` setting (if configured)
2. `reference.docx` next to the Markdown file (if present)
3. Bundled template from `multi-templates/` selected by `referenceLanguage` × `styleProfile`

Bundled template mapping lives in the `BUNDLED_REFERENCE_DOCX` constant in `src/templates.ts`. Academic and `template` profiles share the same academic reference files. Technical, business, official and thesis each have their own English/Chinese pair.

This extension ships **6** templates — it has no `thesis` or `official` profile yet, while the Dify plugin has both. **The VS Code side is the source of truth for the template files**: `scripts/sync-templates.sh` copies them into `dify-plugin-MD2Docx/multi-templates/`, and `scripts/sync-templates.sh --check` (run by CI) fails when they drift.

### Language auto-detection

`detectMarkdownLanguage()` samples the first 20,000 characters. Chinese is selected when CJK character count ≥ 40 OR > 15% of Latin letter count. Otherwise English.

### Style system (two layers, one source of truth)

Both layers read the same preset table, `PROFILE_PRESETS` in `src/profiles.ts`. A preset stores each fact exactly once — the pandoc metadata is *derived* from the typed fields by `buildPandocMetadata()` in `src/profiles.ts`, never stored a second time. Fonts are split into `ascii` (→ `w:ascii`/`w:hAnsi`/`w:cs`) and `eastAsia` (→ `w:eastAsia`) slots so English text is no longer forced into the CJK font.

**Layer 1 — Pandoc metadata** (`buildPandocMetadata` in `src/profiles.ts`): Sets `mainfont`, `CJKmainfont`, `fontsize`, `linestretch` and `monofont` via `--metadata`, derived from the preset's `body`, `bodySizePt`, `lineSpacing` and `monoFont` plus per-setting overrides.

> ⚠️ **Layer 1 never reaches the output.** Pandoc's docx writer ignores `mainfont` / `CJKmainfont` / `fontsize` / `linestretch` once a `--reference-doc` is supplied: with any of the 6 bundled templates, `word/document.xml` and `word/styles.xml` come out **byte-identical** with and without the metadata. The template's own `docDefaults` set the base font, so **Layer 2 is what actually formats the document**. Change Layer 2 when you change how a document looks.

**Layer 2 — DOCX XML overrides** (`applyDocxStyleOverrides`): After pandoc finishes, opens the .docx as a ZIP via `adm-zip` and directly edits `word/styles.xml` and `word/document.xml`. This handles:

- `Normal` style (plus aliases: `a`, `a1`, `Text`, `BodyText`, `Body Text`, `FirstParagraph`, `Compact`) — font, size, line spacing
- `Heading1`/`Heading2`/`Heading3` — font, size
- `SourceCode` + `VerbatimChar` (paragraph styles only) — Consolas 10pt, color #000000, shading #F3F4F6, for every profile whose preset declares a `codeStyle`
- Page margins — `w:pgMar` in `word/document.xml` (mm → twips conversion), defaulting to the preset's margins

Profile defaults live in `PROFILE_PRESETS` (`src/profiles.ts`):

| Profile | Body | Headings | Line spacing | Margins (top/bottom/left/right, mm) |
|---|---|---|---|---|
| `template` | none | none | none | none |
| `academic` | Times New Roman / SimSun 12pt | SimHei 16/14/12pt | 1.5 | 25.4 / 25.4 / 31.75 / 31.75 |
| `business` | Arial / Microsoft YaHei 11pt | Microsoft YaHei 18/14/12pt | 1.5 | 25.4 / 25.4 / 25.4 / 25.4 |
| `technical` | Arial / Microsoft YaHei 11pt | Microsoft YaHei 16/14/12pt | 1.35 | 19 / 19 / 19 / 19 |
| `official` | Times New Roman / FangSong 16pt | SimHei / KaiTi / FangSong 16pt | fixed 29pt (`w:line=580`, `exact`) | 37 / 35 / 28 / 26 |
| `thesis` | Times New Roman / SimSun 12pt | SimHei 22/16/14pt | 1.5 | 30 / 30 / 30 / 30 |

`official` (GB/T 9704 公务公文) and `thesis` (GB/T 7713 学位论文) are defined but not yet exposed in `package.json` or the command palette — that lands with the new commands in a later task, together with the generated template files.

`template` is an empty preset, so it applies **no** style overrides at all and relies entirely on the reference DOCX. Its zero-override behaviour is a consequence of the empty preset, not a special case in the consumer.

> ⚠️ **The two preset tables disagree, and the Layer-2 one wins.** `STYLE_PROFILE_METADATA` (Layer 1) and `getProfileDocxDefaults()` (Layer 2) carry independent line-spacing numbers:
>
> | Profile | Layer 1 `linestretch` | Layer 2 `lineSpacing` |
> |---|---|---|
> | `academic` | 1.5 | 1.5 |
> | `business` | 1.25 | **1.3** |
> | `technical` | 1.2 | **1.25** |
>
> Because Layer 1 is a no-op, the effective spacing is the Layer-2 value — but the two tables drifting apart is how the Dify plugin's `PROFILE_METADATA` / `PROFILE_DEFAULTS` pair got out of step in the first place. Change both together.

### ⚠️ Known defect: style ids are not portable, and the heading overrides do not apply

Layer 2 resolves styles by **`w:styleId`**, and the ids differ per template. Measured against the six bundled templates:

| Style | English templates | Chinese templates |
|---|---|---|
| Normal | id `a` | id `a1` |
| List Number | — | id `a` |
| Normal Table | id `a1` | — |
| heading 1 / 2 / 3 | ids `1` / `2` / `3` | ids `1` / `21` / `31` |
| `SourceCode` / `VerbatimChar` | present | present |

Two consequences:

1. **The heading overrides never take effect.** No template has a `w:styleId="Heading1"`, so `upsertStyleOverride()` falls through to `insertDocxStyle()` and *creates* three orphan `w:customStyle="1"` styles that no paragraph references. The headings keep the template's own formatting, and the exported file carries three dead styles.
2. **The body aliases hit the wrong style on Chinese templates.** `a` is *List Number* there, so the body font/size/spacing also lands on the list-numbering style; the English templates get the body font applied to *Normal Table* via `a1`.

The Dify plugin already avoids this by matching on the **display name** (`w:name`) instead of the id. The same fix belongs here — do not "fix" it by hard-coding `1`/`21`/`31`, because the ids are template-specific and the names are not.

### Binary resolution

`resolveExecutable()` tries candidates in order, runs each with `--version`, returns the first that succeeds. Pandoc candidates include winget package directories (searched recursively for `pandoc.exe`). Mermaid candidates include workspace `node_modules/.bin/mmdc.cmd` and `%APPDATA%/npm/mmdc.cmd` on Windows.

### Legacy config fallback

`readConfigValue()` checks `mdocxConverter.<key>` first, then falls back to `paperifyMd.<key>` for backward compatibility. Uses `config.inspect()` to distinguish "not set" from "explicitly set to default."

### Key design decisions

- The extension does **not** bundle pandoc or mmdc — it discovers them at runtime and fails with install guidance
- **Pandoc is not sandboxed here.** Unlike the Dify plugin, no `--sandbox` is passed, so local image paths and remote image URLs resolve normally and the Mermaid PNGs are found through `--resource-path`. The same Markdown therefore behaves differently in the two products: the Dify plugin requires `data:` URIs for every image.
- `openAfterExport` uses `explorer.exe /select,` on Windows instead of `vscode.env.openExternal` to avoid shell association errors
- Error messages are pattern-matched from pandoc stderr/stdout to produce user-friendly guidance (permission denied, image not found, unknown syntax)
- Temp files are cleaned up unless `keepIntermediateFiles` is set
- Logic is split into pure modules under `src/` (e.g. `src/document.ts`, `src/language.ts`, `src/profiles.ts`, `src/templates.ts`) with `src/extension.ts` as the only module allowed to import `vscode` — this keeps the helpers unit-testable via `node --test`
- Style presets live in exactly one place (`PROFILE_PRESETS` in `src/profiles.ts`); both the pandoc layer and the DOCX layer read it, and pandoc metadata is derived from it rather than stored alongside it
- No bundler: TypeScript compiles `src/` to CommonJS in `out/`, and the unit tests live in `test/unit/`

### VSIX packaging

`.vscodeignore` excludes `src/`, examples, docs, and most assets but whitelists `!node_modules/adm-zip/**` (runtime dependency), `!multi-templates/*.docx`, and `!assets/icon.png`. This keeps the .vsix small.

## Related documents

- `specs/2026-11-14-vsc-plugin-dify-parity-design.md` — the design for reaching parity with the Dify plugin (preset split, font-slot handling, template set).
- `specs/2026-11-14-vsc-plugin-dify-parity-plan.md` — the implementation plan for that design.
- `../AGENTS.md` — repo-wide gotcha cheat sheet (marketplace release flow, CI, environment limits).
- `../dify-plugin-MD2Docx/CLAUDE.md` — the Dify counterpart; its style-system section documents the fixes (name-based style matching, theme-font removal, OOXML child order) that this side has not adopted yet.
