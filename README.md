# MD2Docx Converter

Tools that convert Markdown to polished Word (`.docx`) documents, with built-in Chinese/English templates, Mermaid diagram rendering, and fine-grained style control.

The project ships the same conversion pipeline in two packaging formats — a VS Code extension for local editing and a Dify plugin for workflow automation.

## Subprojects

| Subproject | Path | What it is |
| --- | --- | --- |
| **VS Code extension** | [`VSC-plugin-MD2Docx-Converter/`](./VSC-plugin-MD2Docx-Converter) | Right-click a `.md` file in VS Code and export to `.docx`. Marketplace: [alexmultiagent.mdocx-converter](https://marketplace.visualstudio.com/items?itemName=alexmultiagent.mdocx-converter). |
| **Dify plugin** | [`dify-plugin-MD2Docx/`](./dify-plugin-MD2Docx) | A `md_to_docx` tool usable in Dify workflows and agents. Marketplace: [dify.ai → md2docx](https://marketplace.dify.ai/plugin/alexmultiagent/md2docx). |

Both expose the same `markdown → pandoc → DOCX → style overrides` pipeline; the VS Code extension is the original source of truth and the Dify plugin is a port that re-uses the same reference templates.

## Architecture

```
Markdown text
  ├─ 1. Language detection (CJK vs Latin, first 20K chars)
  ├─ 2. Template resolution (custom > built-in, profile × language → 8 ref.docx)
  ├─ 3. Mermaid preprocessing (Mermaid Ink API → PNG, or mmdc in VS Code)
  ├─ 4. Pandoc conversion (gfm+raw_html → docx via --reference-doc)
  └─ 5. Style overrides (font, size, spacing, margins, code styles)
```

`pypandoc-binary` ships the Pandoc binary inside the pip wheel — no runtime download.

## Built-in templates

8 reference DOCX files in `multi-templates/` of each subdirectory (6 style profiles × 2 languages: `technical`, `business`, `official`, `academic`, `thesis`, `template` × `Chinese`/`English`). The VS Code extension is the source of truth; new templates are added there first and mirrored to the Dify plugin in the same PR.

## Repository layout

```
mdocx-converter/
├── VSC-plugin-MD2Docx-Converter/   # VS Code extension (TypeScript)
├── dify-plugin-MD2Docx/            # Dify plugin (Python)
└── multi-templates/                # (inside each subproject) reference DOCX
```
