# CLAUDE.md
<!-- last_updated: 2026-11-18 -->

Monorepo for **MD2Docx Converter** — tools that export Markdown to Word documents with templates, Mermaid diagram rendering, and style presets.

## Project layout

| Directory | Description |
|---|---|
| `VSC-plugin-MD2Docx-Converter/` | VS Code extension — right-click `.md` → export DOCX |
| `dify-plugin-MD2Docx/` | Dify Tool plugin — `md_to_docx` / `md_to_docx_advanced` / `mermaid_converter` in Dify workflows |
| `scripts/` | `sync-templates.sh` (VSC → Dify template copy) and `check-preset-parity.py` (preset drift gate) |
| `VSC-plugin-MD2Docx-Converter/specs/` | The parity design and implementation plan that produced the shared preset table |

Each subdirectory has its own `CLAUDE.md` with architecture details and build commands. `AGENTS.md` at the repo root is the gotcha cheat sheet — read it before changing either plugin. `CLAUDE.local.md` holds the machine-local notes (the local Dify instance, the Git Bash `docker` path quirks); it is gitignored, so never commit it.

## Build & test

```bash
# VS Code extension
cd VSC-plugin-MD2Docx-Converter
npm install
npm run compile          # tsc -p ./
npm run package          # vsce package → .vsix
npm test                 # compile + node:test unit suite (needs Node >= 22)
npm run test:e2e         # per-profile export check against the real pandoc (needs pandoc)
npm run build:templates  # regenerate multi-templates/ from src/profiles.ts

# Dify plugin
cd dify-plugin-MD2Docx
pip install -r requirements.txt            # runtime deps (pypandoc-binary bundles pandoc, no download)
pip install -r requirements-dev.txt        # dev deps (pytest)
python -c "import ast, pathlib; [ast.parse(p.read_text(encoding='utf-8')) for p in pathlib.Path('src').glob('*.py')]; print('Syntax OK')"
pytest tests/ -v                           # run test suite (pandoc provided by pypandoc-binary)
python scripts/package.py --output MD2Docx.difypkg   # build the plugin package

# Templates (from the repo root)
bash scripts/sync-templates.sh              # copy the VSC templates into the Dify plugin
bash scripts/sync-templates.sh --check      # CI gate: fail when they drift

# Preset parity (from the repo root) — the VS Code side has to be compiled first
cd VSC-plugin-MD2Docx-Converter && npm run compile && cd ..
python scripts/check-preset-parity.py       # CI gate: fail when the two preset tables drift
```

`CI` runs five jobs on every push and pull request: the Dify pytest/package matrix (`dify_plugin` 0.9.0, 0.9.1, 0.11.0 and 0.11.1), VS Code unit tests plus real-Pandoc E2E and VSIX build/upload, template sync, preset parity, and npm/pip dependency audits (see `.github/workflows/ci.yml`).

The Dify `.difypkg` cannot be built with the `dify-plugin` CLI — it is not on PyPI. `scripts/package.py` builds it instead; see "Publishing to the Dify Marketplace" in `dify-plugin-MD2Docx/CLAUDE.md` for the packaging contract and for the CI gates a marketplace PR has to pass.

## Releasing

- **VS Code extension**: `npm run package` → `.vsix` in `VSC-plugin-MD2Docx-Converter/`. Publishing is **automated**: `.github/workflows/publish.yml` fires on a `v*` tag push, re-runs the unit tests and the real-Pandoc E2E exports, builds the VSIX, publishes it through Marketplace **Trusted Publishing** (`npx @vscode/vsce@4.1.1 publish --oidc` — no PAT is stored anywhere), and attaches the same VSIX to a GitHub Release. The publisher's Trusted Publishing policy must name this repository and this workflow file. The workflow refuses to publish unless the tag equals the extension version **and** `dify-plugin-MD2Docx/manifest.yaml` carries the same version — the two products share one version line, so a tag that moved only one of them would ship a VSIX whose plugin counterpart does not exist. Historical tags: `v0.1.0` and `v0.4.0` carry one, 0.2.0, 0.3.0 and 0.4.1 shipped untagged. 0.4.1 is the last version on the Marketplace (published 2026-11-17) — the Marketplace rejects a republished version number.
- **Dify plugin**: a `.difypkg` committed to `AlexMultiAgent/md2docx/` in the `AlexMultiAgent/dify-plugins` fork, pulled into upstream with a PR. One version-update PR = one `.difypkg` file. **The manifest version must be incremented** — the marketplace keys a release by it and rejects a resubmission that reuses or lowers the version. 0.0.5 is published (PR #3797, merged 2026-11-17). The rules are in `dify-plugin-MD2Docx/CLAUDE.md`.
- ⚠️ **Both products share one version line.** `VSC-plugin-MD2Docx-Converter/package.json` and `dify-plugin-MD2Docx/manifest.yaml` carry the **same** version, and a release bumps both. The unified line starts at **0.5.0** (2026-11-18), skipping the previously planned 0.4.2 and 0.0.6 — 0.5.0 is what `package.json` and `manifest.yaml` already say.

## Architecture

```
Markdown text
  ├─ 1. Language detection (CJK vs Latin, first 20K chars)
  ├─ 2. Template resolution (built-in profile x language → 10 ref.docx)
  ├─ 3. Mermaid preprocessing (Dify: Mermaid Ink API → PNG as data: URIs;
  │        VS Code: mmdc locally, Mermaid Ink API as the fallback)
  ├─ 4. Pandoc conversion (gfm+raw_html → docx via --reference-doc; the Dify plugin runs it with --sandbox)
  └─ 5. Style overrides (font, size, spacing, margins, code styles)
```

⚠️ **Pandoc's `--metadata` font/size/spacing never reaches the DOCX.** With every bundled reference template, `word/document.xml` and `word/styles.xml` come out byte-identical with and without it — the template's own `docDefaults` set the base font. **Step 5 is the only layer that formats the document**; the metadata step only leaves a trail in `docProps/custom.xml`. Each plugin's style-system section documents the details.

⚠️ **The Dify plugin sandboxes pandoc.** `--sandbox` blocks URL fetches and local-file reads, so images in the Markdown must be `data:` URIs — Mermaid output is inlined that way automatically, but a user's own `![](logo.png)` no longer resolves. The VS Code extension is not sandboxed and still resolves local files via `--resource-path`.

Templates are at `multi-templates/` under each subdirectory. **Both plugins ship the same 10 files** — academic/technical/business/official/thesis × Chinese/English — generated from one declarative style table by the VS Code side's `scripts/build-templates.js`. The `template` profile reuses the academic pair; the other five have a template of their own.

⚠️ **Template sync note:** the VS Code extension is the primary source for templates. They are **generated** — edit `src/profiles.ts` (or `scripts/reference-base.docx`), run `npm run build:templates`, then `bash scripts/sync-templates.sh`. A hand edit to a `.docx` under `multi-templates/` is overwritten by the next build. `scripts/sync-templates.sh --check` (CI) fails when the two directories drift.

⚠️ **CJK ranges must be written as escapes.** The CJK ideograph ranges are spelled `\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF` (ASCII escapes \uXXXX — copy them as written, they are not placeholders). Written as literal characters the lower bound silently becomes U+8C48 instead of U+F900, and the range then swallows Hangul and Yi syllables — a Korean document gets the Chinese template. The two characters look identical in an editor, so never retype them: both plugins must carry the same byte sequence. ⚠️ **The parity gate does not check this** — `scripts/check-preset-parity.py` compares fonts, sizes, margins, line spacing and the template map, not the regex. Compare the two byte sequences by hand after touching either one.

## 模板修改流程 (Template modification workflow)

模板是**生成**出来的，不要手工编辑 `.docx`：

1. 改 `VSC-plugin-MD2Docx-Converter/src/profiles.ts` 里的 `PROFILE_PRESETS`（字体/字号/页边距）或 `TEMPLATE_LAYOUT`（版式）
2. `cd VSC-plugin-MD2Docx-Converter && npm run build:templates` 重新生成 `multi-templates/` 下的 10 个文件
3. `bash scripts/sync-templates.sh` 复制到 `dify-plugin-MD2Docx/multi-templates/`
4. 同一 PR 内同时提交两侧；`bash scripts/sync-templates.sh --check`（CI 会跑）在两侧不一致时失败
5. CI 会跑 `python scripts/check-preset-parity.py` 核对两端 preset 逐项一致；改了任一端后可本地运行同一命令快速定位漂移
6. 更新两边 `CLAUDE.md` 中的模板数量说明

## Git

- Main branch: `main`
- Repo: `https://github.com/AlexMultiAgent/mdocx-converter`
- ⚠️ **禁止在提交信息中添加 `Co-Authored-By: Claude ...` 等任何 Claude 共同作者标记。所有提交作者仅限 AlexMultiAgent。**
