# CLAUDE.md
<!-- last_updated: 2026-11-14 -->

Monorepo for **MD2Docx Converter** — tools that export Markdown to Word documents with templates, Mermaid diagram rendering, and style presets.

## Project layout

| Directory | Description |
|---|---|
| `VSC-plugin-MD2Docx-Converter/` | VS Code extension — right-click `.md` → export DOCX |
| `dify-plugin-MD2Docx/` | Dify Tool plugin — `md_to_docx` in Dify workflows |

Each subdirectory has its own `CLAUDE.md` with architecture details and build commands.

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
# Packaging
dify-plugin plugin package . -o MD2Docx.difypkg   # ~236 KB .difypkg
```

## Architecture

```
Markdown text
  ├─ 1. Language detection (CJK vs Latin, first 20K chars)
  ├─ 2. Template resolution (custom > built-in, profile x language → 8 ref.docx)
  ├─ 3. Mermaid preprocessing (Mermaid Ink API → PNG, or mmdc in VS Code)
  ├─ 4. Pandoc conversion (gfm+raw_html → docx via --reference-doc)
  └─ 5. Style overrides (font, size, spacing, margins, code styles)
```

Templates are at `multi-templates/` under each subdirectory. The Dify plugin ships **8** files (academic/technical/business/official x Chinese/English; `thesis` and `template` reuse the academic pair), the VS Code extension ships **6** (no `official` yet). The `official` files are byte-identical copies of the academic ones — the `official` preset differs only through its style defaults.

⚠️ **Template sync note:** the VS Code extension is the primary source for templates. When adding new templates, update both subdirectories and keep the file names identical so `scripts/sync-templates.sh --check` stays green.

## 模板修改流程 (Template modification workflow)

1. 在 `VSC-plugin-MD2Docx-Converter/multi-templates/` 修改源模板
2. 复制到 `dify-plugin-MD2Docx/multi-templates/`（保持文件名一致）
3. 同一 PR 内同时提交两侧，确保两边模板始终同步
4. 更新两边的 `CLAUDE.md` 中的模板数量说明

## Git

- Main branch: `main`
- Repo: `https://github.com/AlexMultiAgent/mdocx-converter`
- ⚠️ **禁止在提交信息中添加 `Co-Authored-By: Claude ...` 等任何 Claude 共同作者标记。所有提交作者仅限 AlexMultiAgent。**
