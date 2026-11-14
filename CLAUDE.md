# CLAUDE.md
<!-- last_updated: 2026-11-14 -->

Monorepo for **MD2Docx Converter** — tools that export Markdown to Word documents with templates, Mermaid diagram rendering, and style presets.

## Project layout

| Directory | Description |
|---|---|
| `VSC-plugin-MD2Docx-Converter/` | VS Code extension — right-click `.md` → export DOCX |
| `dify-plugin-MD2Docx/` | Dify Tool plugin — `md_to_docx` in Dify workflows |

Each subdirectory has its own `CLAUDE.md` with architecture details and build commands. `AGENTS.md` at the repo root is the gotcha cheat sheet — read it before changing either plugin.

## Build & test

```bash
# VS Code extension
cd VSC-plugin-MD2Docx-Converter
npm install
npm run compile          # tsc -p ./
npm run package          # vsce package → .vsix

# Dify plugin
cd dify-plugin-MD2Docx
pip install -r requirements.txt            # runtime deps (pypandoc-binary bundles pandoc, no download)
pip install -r requirements-dev.txt        # dev deps (pytest, dify_plugin for local testing)
python -c "import ast; ast.parse(open('src/md2docx.py', encoding='utf-8').read()); print('Syntax OK')"
pytest tests/ -v                           # run test suite (pandoc provided by pypandoc-binary)
python scripts/package.py --output MD2Docx.difypkg   # build the plugin package
```

`CI` runs on every push and pull request: the Dify plugin's pytest suite (against both the minimum and the current `dify_plugin` SDK), the package build, and `scripts/sync-templates.sh --check` (see `.github/workflows/ci.yml`).

The Dify `.difypkg` cannot be built with the `dify-plugin` CLI — it is not on PyPI. `scripts/package.py` builds it instead; see "Publishing to the Dify Marketplace" in `dify-plugin-MD2Docx/CLAUDE.md` for the packaging contract and for the CI gates a marketplace PR has to pass.

## Releasing

- **VS Code extension**: `npm run package` → `.vsix`, published from `VSC-plugin-MD2Docx-Converter/`.
- **Dify plugin**: a `.difypkg` committed to `AlexMultiAgent/md2docx/` in the `AlexMultiAgent/dify-plugins` fork, pulled into upstream with a PR. One version-update PR = one `.difypkg` file. The rules are in `dify-plugin-MD2Docx/CLAUDE.md`.

## Architecture

```
Markdown text
  ├─ 1. Language detection (CJK vs Latin, first 20K chars)
  ├─ 2. Template resolution (built-in profile x language → 10 ref.docx)
  ├─ 3. Mermaid preprocessing (Mermaid Ink API → PNG embedded as data: URIs; mmdc in VS Code)
  ├─ 4. Pandoc conversion (gfm+raw_html → docx via --reference-doc; the Dify plugin runs it with --sandbox)
  └─ 5. Style overrides (font, size, spacing, margins, code styles)
```

⚠️ **Pandoc's `--metadata` font/size/spacing never reaches the DOCX.** With every bundled reference template, `word/document.xml` and `word/styles.xml` come out byte-identical with and without it — the template's own `docDefaults` set the base font. **Step 5 is the only layer that formats the document**; the metadata step only leaves a trail in `docProps/custom.xml`. Each plugin's style-system section documents the details.

⚠️ **The Dify plugin sandboxes pandoc.** `--sandbox` blocks URL fetches and local-file reads, so images in the Markdown must be `data:` URIs — Mermaid output is inlined that way automatically, but a user's own `![](logo.png)` no longer resolves. The VS Code extension is not sandboxed and still resolves local files via `--resource-path`.

Templates are at `multi-templates/` under each subdirectory. **Both plugins ship the same 10 files** — academic/technical/business/official/thesis × Chinese/English — generated from one declarative style table by the VS Code side's `scripts/build-templates.js`. The `template` profile reuses the academic pair; the other five have a template of their own.

⚠️ **Template sync note:** the VS Code extension is the primary source for templates. When adding new templates, update both subdirectories and keep the file names identical so `scripts/sync-templates.sh --check` stays green.

⚠️ **CJK ranges must be written as escapes.** The CJK ideograph ranges are spelled `\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF` (ASCII escapes \uXXXX — copy them as written, they are not placeholders). Written as literal characters the lower bound silently becomes U+8C48 instead of U+F900, and the range then swallows Hangul and Yi syllables — a Korean document gets the Chinese template. The two characters look identical in an editor, so never retype them: both plugins must carry the same byte sequence.

## 模板修改流程 (Template modification workflow)

1. 在 `VSC-plugin-MD2Docx-Converter/multi-templates/` 修改源模板
2. 复制到 `dify-plugin-MD2Docx/multi-templates/`（保持文件名一致）
3. 同一 PR 内同时提交两侧，确保两边模板始终同步
4. 更新两边的 `CLAUDE.md` 中的模板数量说明

## Git

- Main branch: `main`
- Repo: `https://github.com/AlexMultiAgent/mdocx-converter`
- ⚠️ **禁止在提交信息中添加 `Co-Authored-By: Claude ...` 等任何 Claude 共同作者标记。所有提交作者仅限 AlexMultiAgent。**
