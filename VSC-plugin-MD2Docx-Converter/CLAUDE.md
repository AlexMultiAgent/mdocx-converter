# CLAUDE.md

This extension lives in the `VSC-plugin-MD2Docx-Converter/` directory of the [mdocx-converter](https://github.com/AlexMultiAgent/mdocx-converter) monorepo. The sibling `dify-plugin-MD2Docx/` directory contains a Dify Tool plugin port of the same pipeline.

## Commands

```bash
npm install           # install dependencies (typescript, adm-zip, etc.)
npm run compile       # tsc -p ./  — compiles src/ to out/
npm run watch         # tsc -watch -p ./
npm run package       # vsce package --allow-missing-repository  — creates .vsix
```

Press `F5` in VS Code to launch an Extension Development Host for manual testing.

There is no test suite.

## Architecture

This is a **VS Code extension** that exports Markdown files to DOCX. The entire extension lives in a single file: `src/extension.ts` (~1230 lines). It compiles to `out/extension.js` via TypeScript.

### Conversion pipeline

```
Markdown file
  │
  ├─ 1. Mermaid preprocessing: regex-extract ```mermaid blocks → mmdc → PNG/SVG
  │     Replaces each fenced block with ![Mermaid Diagram N](path/to/rendered.png)
  │     Produces a temp Markdown file in os.tmpdir()
  │
  ├─ 2. Pandoc: gfm+raw_html → docx via --reference-doc (template)
  │     Metadata injected via --metadata (mainfont, CJKmainfont, fontsize, linestretch)
  │     --resource-path set to both the original Markdown dir and the temp dir
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

Bundled template mapping lives in `BUNDLED_REFERENCE_DOCX_BY_PROFILE_AND_LANGUAGE` constant. Academic and `template` profiles share the same academic reference files. Technical and business each have their own English/Chinese pair.

### Language auto-detection

`detectMarkdownLanguage()` samples the first 20,000 characters. Chinese is selected when CJK character count ≥ 40 OR > 15% of Latin letter count. Otherwise English.

### Style system (two layers)

**Layer 1 — Pandoc metadata** (`buildPandocMetadata`): Sets `mainfont`, `CJKmainfont`, `fontsize`, `linestretch` via `--metadata`. These come from `STYLE_PROFILE_METADATA` plus per-setting overrides.

**Layer 2 — DOCX XML overrides** (`applyDocxStyleOverrides`): After pandoc finishes, opens the .docx as a ZIP via `adm-zip` and directly edits `word/styles.xml` and `word/document.xml`. This handles:

- `Normal` style (plus aliases: `a`, `a1`, `Text`, `BodyText`, `Body Text`, `FirstParagraph`, `Compact`) — font, size, line spacing
- `Heading1`/`Heading2`/`Heading3` — font, size
- `SourceCode` + `VerbatimChar` (technical profile only) — Consolas 10pt, color #1F2937, shading #F3F4F6
- Page margins — `w:pgMar` in `word/document.xml` (mm → twips conversion)

Profile defaults are hardcoded in `getProfileDocxDefaults()`:
- `academic`: SimSun body 12pt, SimHei headings, 1.5 line spacing
- `business`: Arial body 11pt, Arial headings, 1.3 line spacing
- `technical`: Arial body 11pt, Arial headings, 1.25 line spacing, Consolas code
- `template`: no defaults (rely on reference.docx entirely)

### Binary resolution

`resolveExecutable()` tries candidates in order, runs each with `--version`, returns the first that succeeds. Pandoc candidates include winget package directories (searched recursively for `pandoc.exe`). Mermaid candidates include workspace `node_modules/.bin/mmdc.cmd` and `%APPDATA%/npm/mmdc.cmd` on Windows.

### Legacy config fallback

`readConfigValue()` checks `mdocxConverter.<key>` first, then falls back to `paperifyMd.<key>` for backward compatibility. Uses `config.inspect()` to distinguish "not set" from "explicitly set to default."

### Key design decisions

- The extension does **not** bundle pandoc or mmdc — it discovers them at runtime and fails with install guidance
- `openAfterExport` uses `explorer.exe /select,` on Windows instead of `vscode.env.openExternal` to avoid shell association errors
- Error messages are pattern-matched from pandoc stderr/stdout to produce user-friendly guidance (permission denied, image not found, unknown syntax)
- Temp files are cleaned up unless `keepIntermediateFiles` is set
- The entire extension is a single file — no modules, no test infrastructure, no bundler

### VSIX packaging

`.vscodeignore` excludes `src/`, examples, docs, and most assets but whitelists `!node_modules/adm-zip/**` (runtime dependency), `!multi-templates/*.docx`, and `!assets/icon.png`. This keeps the .vsix small.
