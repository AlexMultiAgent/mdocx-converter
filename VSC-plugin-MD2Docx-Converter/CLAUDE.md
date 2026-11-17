# CLAUDE.md

This extension lives in the `VSC-plugin-MD2Docx-Converter/` directory of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo. The sibling `dify-plugin-MD2Docx/` directory contains a Dify Tool plugin port of the same pipeline.

## Commands

```bash
npm install           # install dependencies (typescript, adm-zip, etc.)
npm run compile       # tsc -p ./  — compiles src/ to out/
npm run watch         # tsc -watch -p ./
npm run package       # vsce package --allow-missing-repository  — creates .vsix
npm test              # compile + node:test unit suite (needs Node >= 22 for --test globs)
npm run test:e2e      # per-profile export check against the real pandoc (needs pandoc)
npm run build:templates   # regenerate multi-templates/ from src/profiles.ts
```

Press `F5` in VS Code to launch an Extension Development Host for manual testing.

## Testing

Unit tests live in `test/unit/*.test.js` — 12 files — and run on Node's built-in `node:test` runner — no test framework dependency.

- The test glob is `test/unit/**/*.test.js`, so **every test file must be named `*.test.js`** or it will be silently skipped.
- `npm test` compiles `src/` to `out/` first, then the tests `require()` the compiled output (e.g. `require('../../out/document.js')`). `test/` is not part of the TypeScript build.
- A glob that matches nothing exits 0, so a renamed test file looks like a passing run. If `npm test` reports zero tests, the naming convention was broken.
- Node 18/20 lack `--test` glob support; use Node >= 22.

**CI runs on `ubuntu-latest` and the local machine is Windows — the two disagree about process handling and shell quoting.** Run the suite in a Linux container before pushing:

```bash
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "d:/GitHub/mdocx-converter/VSC-plugin-MD2Docx-Converter:/app" \
  -v mdocx-node-modules:/app/node_modules -w /app node:24 \
  bash -c "npm ci --silent >/dev/null 2>&1 && npm test"
```

`MSYS_NO_PATHCONV=1` is required — Git Bash otherwise rewrites `/app` into a Windows path. The named volume keeps `node_modules` out of the host tree.

**A process that has terminated but has not been reaped yet is a zombie**, and `kill(pid, 0)` still succeeds for it. The test helper therefore reads the process state (`/proc/<pid>/stat`, `ps` elsewhere) instead of trusting the signal: a zombie counts as terminated. Without this the cancellation test fails in a container, where nothing reaps the orphaned grandchild promptly.

`npm run test:e2e` (`test/e2e/run.js`) is a **manual end-to-end check** — it drives the real `pandoc` for each of the 5 profiles × 2 languages against the bundled templates, applies the extension's own override layer from `out/docxStyles.js`, then asserts the exported body font, body size, heading font, heading size, page size, the page-number footer and all four margins. It needs pandoc on the runner, so it is **not** wired into CI. The repo CI (`.github/workflows/ci.yml`) runs four jobs: the Dify plugin's pytest suite, this extension's `npm test`, `scripts/sync-templates.sh --check`, and `scripts/check-preset-parity.py`. The parity gate compares the preset table of this side with the one of the Dify plugin — it needs `npm run compile` first, because it reads `out/profiles.js` and `out/templates.js`.

## Architecture

This is a **VS Code extension** that exports Markdown files to DOCX. Everything compiles to `out/` via TypeScript.

### Source layout

| Module | Contents |
|---|---|
| `src/extension.ts` | Command wiring, settings, pandoc invocation, adm-zip style overrides, progress UI |
| `src/profiles.ts` | `PROFILE_PRESETS` — the single source of truth for every style profile; `TEMPLATE_LAYOUT` for the template generator |
| `src/language.ts` | CJK/Latin language detection |
| `src/templates.ts` | Bundled template map and candidate paths |
| `src/mermaid.ts` | Mermaid block parsing, pako encoding, Mermaid Ink API client |
| `src/document.ts` | Document title extraction, filename sanitising |
| `src/docxStyles.ts` | DOCX style lookup by display name, OOXML child order, the style override layer |
| `src/docxParts.ts` | ZIP part lookup that tolerates backslash-separated entry names |
| `src/process.ts` | Child processes: the shell escaping, the output limit and the cancellation |

**Only `src/extension.ts` may import `vscode`.** Every other module must stay pure so that `node --test` can load the compiled output directly outside the Extension Host.

### Conversion pipeline

```
Markdown file
  │
  ├─ 1. Mermaid preprocessing: regex-extract ```mermaid blocks → mmdc → PNG/SVG
  │     Falls back to the Mermaid Ink API when mmdc is unavailable (4 diagrams at a time, shared 120s budget)
  │     A diagram that fails both ways stays a code block — the export still succeeds
  │     Replaces each fenced block with ![Mermaid Diagram N](./mermaid-assets/diagram-N.png)
  │     (.svg when mermaidOutputFormat=svg — the Mermaid Ink fallback always writes .png)
  │     Produces a temp Markdown file in os.tmpdir()
  │
  ├─ 2. Pandoc: gfm+raw_html → docx via --reference-doc (template)
  │     Metadata injected via --metadata (mainfont, CJKmainfont, fontsize, linestretch, monofont)
  │     plus a separate title=<document title> — of the six, only `title` reaches the output
  │     (pandoc writes it into the DOCX core properties, as dc:title)
  │     --resource-path set to both the original Markdown dir and the temp dir
  │     NOT sandboxed — local image paths and remote URLs still resolve
  │
  └─ 3. DOCX style overrides: adm-zip opens the generated .docx
        Edits word/styles.xml  — font, size, spacing, color, shading per display name
        Edits word/document.xml — page margins (w:pgMar)
```

### Command registration (8 commands)

| Command ID | Trigger |
|---|---|
| `mdocxConverter.exportToDocx` | Command palette (generic export, uses current `styleProfile` setting) |
| `mdocxConverter.exportAcademicPaper` | Right-click submenu — forces `styleProfile=academic, referenceLanguage=auto` |
| `mdocxConverter.exportTechnicalDocument` | Right-click submenu — forces `styleProfile=technical, referenceLanguage=auto` |
| `mdocxConverter.exportBusinessReport` | Right-click submenu — forces `styleProfile=business, referenceLanguage=auto` |
| `mdocxConverter.exportOfficialDocument` | Right-click submenu — forces `styleProfile=official, referenceLanguage=auto` (GB/T 9704) |
| `mdocxConverter.exportThesis` | Right-click submenu — forces `styleProfile=thesis, referenceLanguage=auto` (GB/T 7713) |
| `mdocxConverter.renderMermaidToImage` | Command palette and editor context menu — renders the selected Mermaid block (or the one under the cursor) to a PNG next to the document and inserts the reference |
| `mdocxConverter.checkEnvironment` | Checks pandoc and mmdc availability, the Mermaid renderer mode, the Mermaid Ink API reachability, the number of bundled templates and the active style profile |

The 5 submenu commands override `styleProfile` and `referenceLanguage` regardless of user settings. This is the primary UX: right-click an `.md` file → choose document type → get auto language detection + template selection.

### Settings

`package.json` contributes 25 `mdocxConverter.*` settings. The 13 style overrides map 1:1 onto the Dify plugin's advanced-tool parameters — the names differ only in case style, so a change on one side has a counterpart on the other:

| VS Code setting | Dify tool parameter |
|---|---|
| `bodyFont` | `body_font` |
| `bodySizePt` | `body_size_pt` |
| `lineSpacing` | `line_spacing` |
| `marginTopMm` | `margin_top_mm` |
| `marginBottomMm` | `margin_bottom_mm` |
| `marginLeftMm` | `margin_left_mm` |
| `marginRightMm` | `margin_right_mm` |
| `heading1Font` | `heading1_font` |
| `heading1SizePt` | `heading1_size_pt` |
| `heading2Font` | `heading2_font` |
| `heading2SizePt` | `heading2_size_pt` |
| `heading3Font` | `heading3_font` |
| `heading3SizePt` | `heading3_size_pt` |

An empty string or `0` falls back to the profile default, and an explicit font fills **both** the Latin and the East-Asian slot (`resolveFontPair`) — the same rule the Dify side uses. The remaining 12 settings have no Dify counterpart: `pandocPath`, `mermaidCliPath`, `referenceDocx`, `referenceLanguage`, `styleProfile`, `outputDirectory`, `mermaidRenderer`, `mermaidOutputFormat`, `mermaidApiUrl`, `documentTitle`, `openAfterExport`, `keepIntermediateFiles`.

Each one also has a `paperifyMd.*` legacy alias — see "Legacy config fallback" below.

### Template resolution order

1. `mdocxConverter.referenceDocx` setting (if configured)
2. `reference.docx` next to the Markdown file (if present)
3. Bundled template from `multi-templates/` selected by `referenceLanguage` × `styleProfile`

Bundled template mapping lives in the `BUNDLED_REFERENCE_DOCX` constant in `src/templates.ts`. Academic and `template` profiles share the same academic reference files. Technical, business, official and thesis each have their own English/Chinese pair.

This extension ships the same **10** templates as the Dify plugin — academic, technical, business, official and thesis, each in an English and a Chinese variant. **The VS Code side is the source of truth for the template files**: they are **generated** by `npm run build:templates` from `src/profiles.ts` + `scripts/reference-base.docx`, `scripts/sync-templates.sh` copies them into `dify-plugin-MD2Docx/multi-templates/`, and `scripts/sync-templates.sh --check` (run by CI) fails when they drift. Never hand-edit a `.docx` under `multi-templates/` — the next build overwrites it.

#### Template metadata

`npm run build:templates` sanitizes every generated template as part of the build. `scripts/build-templates.js` rewrites `docProps/core.xml` to clear `dc:title`, `dc:creator`, `cp:lastModifiedBy`, `dc:subject` and `cp:keywords`, and resets `cp:revision` to 1. It rewrites `docProps/app.xml` to reset Word's document statistics and remove `ap:HLinks`. The base DOCX stays untouched; only the emitted templates are sanitized.

This step is implemented in Node rather than delegated to `scripts/sanitize-docx-metadata.ps1`, so the same build works on Windows and Linux. The PowerShell file remains a manual helper for sanitizing an existing DOCX, not a build prerequisite. `test/unit/templates.test.js` checks all ten shipped templates for placeholder metadata, so a later change that bypasses the sanitizer fails CI. After rebuilding, run `bash scripts/sync-templates.sh` to copy both sides into parity.

### Language auto-detection

`detectMarkdownLanguage()` samples the first 20,000 characters. Chinese is selected when CJK character count ≥ 40 OR > 15% of Latin letter count. Otherwise English.

### Style system (two layers, one source of truth)

Both layers read the same preset table, `PROFILE_PRESETS` in `src/profiles.ts`. A preset stores each fact exactly once — the pandoc metadata is *derived* from the typed fields by `buildPandocMetadata()` in `src/profiles.ts`, never stored a second time. Fonts are split into `ascii` (→ `w:ascii`/`w:hAnsi`/`w:cs`) and `eastAsia` (→ `w:eastAsia`) slots so English text is no longer forced into the CJK font.

**Layer 1 — Pandoc metadata** (`buildPandocMetadata` in `src/profiles.ts`): Sets `mainfont`, `CJKmainfont`, `fontsize`, `linestretch` and `monofont` via `--metadata`, derived from the preset's `body`, `bodySizePt`, `lineSpacing` and `monoFont` plus per-setting overrides.

> ⚠️ **Layer 1 never reaches the output.** Pandoc's docx writer ignores `mainfont` / `CJKmainfont` / `fontsize` / `linestretch` once a `--reference-doc` is supplied: with any of the 10 bundled templates, `word/document.xml` and `word/styles.xml` come out **byte-identical** with and without the metadata. The template's own `docDefaults` set the base font, so **Layer 2 is what actually formats the document**. Change Layer 2 when you change how a document looks.

**Layer 2 — DOCX XML overrides** (`applyDocxStyleOverrides`): After pandoc finishes, opens the .docx as a ZIP via `adm-zip` and directly edits `word/styles.xml` and `word/document.xml`. This handles:

- Body styles — font, size, line spacing
- Heading 1 / 2 / 3 — font, size
- Source code + verbatim char — font, size, color, shading
- Page margins — `w:pgMar` in `word/document.xml` (mm → twips conversion), defaulting to the preset's margins

Styles are matched by **display name** (`w:name`), never by `w:styleId`. See "Matching styles by display name" below for why.

Profile defaults live in `PROFILE_PRESETS` (`src/profiles.ts`):

| Profile | Body | Headings | Line spacing | Margins (top/bottom/left/right, mm) |
|---|---|---|---|---|
| `template` | none | none | none | none |
| `academic` | Times New Roman / SimSun 12pt | Times New Roman / SimHei 16/14/12pt | 1.5 | 25.4 / 25.4 / 31.75 / 31.75 |
| `business` | Arial / Microsoft YaHei 11pt | Arial / Microsoft YaHei 18/14/12pt | 1.5 | 25.4 / 25.4 / 25.4 / 25.4 |
| `technical` | Arial / Microsoft YaHei 11pt | Arial / Microsoft YaHei 16/14/12pt | 1.35 | 19 / 19 / 19 / 19 |
| `official` | Times New Roman / FangSong 16pt | Times New Roman / SimHei, KaiTi, FangSong 16pt | fixed 29pt (`w:line=580`, `exact`) | 37 / 35 / 28 / 26 |
| `thesis` | Times New Roman / SimSun 12pt | Times New Roman / SimHei 22/16/14pt | 1.5 | 30 / 30 / 30 / 30 |

`official` (GB/T 9704 公务公文) and `thesis` (GB/T 7713 学位论文) have their own templates and their own export commands.

`template` is an empty preset, so it applies **no** style overrides at all and relies entirely on the reference DOCX. Its zero-override behaviour is a consequence of the empty preset, not a special case in the consumer.

#### Matching styles by display name

`src/docxStyles.ts` resolves every target style by its **display name** (`w:name`), not by `w:styleId`.

This matters because `w:styleId` is not portable across templates — Word mints arbitrary ids when a template is saved. The ids for the same style differ per template, and some ids collide with unrelated styles:

| Display name | old Chinese template | old English template |
|---|---|---|
| Normal | `a1` | `a` |
| heading 1 / 2 / 3 | `1` / `21` / `31` | `1` / `2` / `3` |
| **List Number** | **`a`** | — |
| **Normal Table** | `a3` | **`a1`** |

An id-based lookup that guessed `a`/`a1` therefore hit *List Number* on the Chinese template and *Normal Table* on the English one, pushing the body font onto a style that no body paragraph uses. When nothing matched, the old code fell back to *creating* the style — which produced ten unreferenced orphans (`a`, `a1`, `Text`, `Body Text`, `1`, `2`, `21`, `3`, `31`, `Code`) in every exported file, and left the headings with the template's own formatting.

`upsertStyleOverride()` now matches on the name (case-insensitively, so OOXML's `heading 1` and Word's `Heading 1` both hit), with an exact `w:styleId` match as a second chance, and only creates a style when **neither** matched. `BODY_STYLE_NAMES` deliberately excludes `List Number` and `Normal Table`.

The Dify plugin reaches the same result through python-docx, whose `doc.styles[name]` lookup is name-first.

### Binary resolution

`resolveExecutable()` tries candidates in order, runs each with `--version`, returns the first that succeeds. Pandoc candidates include winget package directories (searched recursively for `pandoc.exe`). Mermaid candidates include workspace `node_modules/.bin/mmdc.cmd` and `%APPDATA%/npm/mmdc.cmd` on Windows.

### Legacy config fallback

`readConfigValue()` checks `mdocxConverter.<key>` first, then falls back to `paperifyMd.<key>` for backward compatibility. Uses `config.inspect()` to distinguish "not set" from "explicitly set to default."

### Key design decisions

- The extension does **not** bundle pandoc or mmdc — it discovers them at runtime. A missing mmdc is no longer fatal: with `mermaidRenderer=auto` the Mermaid Ink API renders the diagram instead, and a diagram that fails both ways is kept as a code block so the rest of the export still succeeds
- **Pandoc is not sandboxed here.** Unlike the Dify plugin, no `--sandbox` is passed, so local image paths and remote image URLs resolve normally and the Mermaid PNGs are found through `--resource-path`. The same Markdown therefore behaves differently in the two products: the Dify plugin requires `data:` URIs for every image.
- `openAfterExport` uses `explorer.exe /select,` on Windows instead of `vscode.env.openExternal` to avoid shell association errors
- Error messages are pattern-matched from pandoc stderr/stdout to produce user-friendly guidance (permission denied, image not found, unknown syntax)
- Temp files are cleaned up unless `keepIntermediateFiles` is set. A failure during the cleanup never turns a finished export into a failed command
- Pandoc writes to a staging file next to the target, and the finished document is renamed into place. The path the user chose therefore only ever holds a complete document — a cancelled export leaves nothing behind
- Logic is split into pure modules under `src/` (see the source layout above) with `src/extension.ts` as the only module allowed to import `vscode` — this keeps the helpers unit-testable via `node --test`
- Style presets live in exactly one place (`PROFILE_PRESETS` in `src/profiles.ts`); both the pandoc layer and the DOCX layer read it, and pandoc metadata is derived from it rather than stored alongside it
- No bundler: TypeScript compiles `src/` to CommonJS in `out/`, and the unit tests live in `test/unit/`
- The export runs inside `vscode.window.withProgress` and is cancellable: the pandoc call uses `spawn` (not `execFile`) so the child process can be killed, and a cancelled export reports "Export cancelled." rather than a failure
- Cancelling takes down the whole process tree (`taskkill /T /F` on Windows). A `.cmd` runs through `cmd.exe`, so killing the direct child would leave the grandchild alive with the stdout pipe open — the export would hang instead of stopping
- The arguments of a `.cmd` are escaped by `src/process.ts`. Node's own shell mode concatenates them without escaping, so a metacharacter in a path would run a second command. A line break inside an argument cannot survive a batch file and truncates the argument, but it cannot run a second command either
- The Mermaid Ink API is used only after the user has been told that the diagram source leaves the machine — the notice comes before the first request, not after it
- The request to the Mermaid Ink service is aborted when the export is cancelled, so the diagram source does not keep travelling after the user gave up
- The document title comes from `mdocxConverter.documentTitle`, else the first ATX heading (`src/document.ts`), else the sanitised file name

### VSIX packaging

`.vscodeignore` excludes `src/`, `test/`, `specs/`, `scripts/`, examples, docs, and most assets but whitelists `!node_modules/adm-zip/**` (runtime dependency), the 10 `!multi-templates/*.docx` files, and `!assets/icon.png`, `!assets/banner.png`, `!assets/mermaid-example.png`. This keeps the .vsix small.

## Related documents

- `specs/2026-11-14-vsc-plugin-dify-parity-design.md` — the design for reaching parity with the Dify plugin (preset split, font-slot handling, template set).
- `specs/2026-11-14-vsc-plugin-dify-parity-plan.md` — the implementation plan for that design.
- `../AGENTS.md` — repo-wide gotcha cheat sheet (marketplace release flow, CI, environment limits).
- `../dify-plugin-MD2Docx/CLAUDE.md` — the Dify counterpart. Name-based style matching and OOXML child order are now adopted on both sides; the Dify side additionally strips theme-font attributes, which this side does not need because it replaces the whole `w:rFonts` element.
