"""Compare the VS Code preset table and template map with the Dify plugin's.

The two plugins keep their style presets in different languages — TypeScript
in ``src/profiles.ts`` and Python in ``src/md2docx.py`` — so nothing can
check them at the same time. This script reads both and reports any drift.

Run it from the repository root:

    cd VSC-plugin-MD2Docx-Converter && npm run compile && cd ..
    python scripts/check-preset-parity.py

It needs the VS Code side built (for ``out/profiles.js`` and
``out/templates.js``) and the Dify side's Python dependencies installed.
"""

import importlib.util
import os
import json
import subprocess
import sys

VSC = 'VSC-plugin-MD2Docx-Converter'
DIFY = 'dify-plugin-MD2Docx'

# --- VS Code side ---
out = subprocess.run(
    ['node', '-e',
     "const p=require('./%s/out/profiles.js');const t=require('./%s/out/templates.js');"
     "console.log(JSON.stringify({presets:p.PROFILE_PRESETS, map:t.BUNDLED_REFERENCE_DOCX}))" % (VSC, VSC)],
    capture_output=True, text=True, cwd='.',
)
if out.returncode != 0:
    print(out.stderr)
    sys.exit(1)
vsc = json.loads(out.stdout)
vsc_presets = vsc['presets']
vsc_map = vsc['map']

# --- Dify side ---
spec = importlib.util.spec_from_file_location('md2docx_probe', DIFY + '/src/md2docx.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
dify_presets = mod.PROFILE_DEFAULTS
dify_map = mod.TEMPLATE_MAP

problems = []

FONT_MAP = {
    'body': ('body_font', 'body_cjk_font'),
    'heading1': ('heading1_font', 'heading1_cjk_font'),
    'heading2': ('heading2_font', 'heading2_cjk_font'),
    'heading3': ('heading3_font', 'heading3_cjk_font'),
}
SIZE_MAP = {
    'bodySizePt': 'body_size_pt',
    'heading1SizePt': 'heading1_size_pt',
    'heading2SizePt': 'heading2_size_pt',
    'heading3SizePt': 'heading3_size_pt',
}
MARGIN_MAP = {
    'marginTopMm': 'margin_top_mm',
    'marginBottomMm': 'margin_bottom_mm',
    'marginLeftMm': 'margin_left_mm',
    'marginRightMm': 'margin_right_mm',
}

for profile in sorted(set(vsc_presets) | set(dify_presets)):
    v = vsc_presets.get(profile, {})
    d = dify_presets.get(profile, {})
    if profile == 'template':
        if v or d:
            problems.append((profile, 'the template preset should be empty on both sides'))
        continue

    for vkey, (d_ascii, d_cjk) in FONT_MAP.items():
        pair = v.get(vkey)
        if not pair:
            problems.append((profile, f'{vkey} is missing on the VS Code side'))
            continue
        if d.get(d_ascii) != pair['ascii']:
            problems.append((profile, f'{d_ascii}: {d.get(d_ascii)!r} != {pair["ascii"]!r}'))
        if d.get(d_cjk) != pair['eastAsia']:
            problems.append((profile, f'{d_cjk}: {d.get(d_cjk)!r} != {pair["eastAsia"]!r}'))

    for vkey, dkey in SIZE_MAP.items():
        if v.get(vkey) != d.get(dkey):
            problems.append((profile, f'{dkey}: {d.get(dkey)!r} != {v.get(vkey)!r}'))

    for vkey, dkey in MARGIN_MAP.items():
        if v.get(vkey) != d.get(dkey):
            problems.append((profile, f'{dkey}: {d.get(dkey)!r} != {v.get(vkey)!r}'))

    v_twips = v.get('lineSpacingTwips')
    v_mult = v.get('lineSpacing')
    d_twips = d.get('line_spacing_twips')
    d_mult = d.get('line_spacing')
    if v_twips is not None:
        if d_twips != v_twips:
            problems.append((profile, f'line_spacing_twips: {d_twips!r} != {v_twips!r}'))
    elif v_mult is not None:
        if d_mult != v_mult:
            problems.append((profile, f'line_spacing: {d_mult!r} != {v_mult!r}'))

# --- template map ---
for profile in sorted(set(vsc_map) | set(dify_map)):
    v = vsc_map.get(profile, {})
    d = dify_map.get(profile, {})
    for language in ('english', 'chinese'):
        # The VS Code side stores a path relative to the extension root, the
        # Dify side a bare file name; compare the file names.
        v_name = v.get(language, '').replace(os.sep, '/').split('/')[-1]
        d_name = d.get(language, '').replace(os.sep, '/').split('/')[-1]
        if v_name != d_name:
            problems.append((profile, f'template for {language}: {d_name!r} != {v_name!r}'))

print('profiles compared:', sorted(set(vsc_presets) | set(dify_presets)))
print('template maps compared:', sorted(set(vsc_map) | set(dify_map)))
if problems:
    print(f'\n{len(problems)} MISMATCH(ES):')
    for profile, what in problems:
        print(f'  {profile}: {what}')
    sys.exit(1)
print('\nEvery font, size, margin, line-spacing value and template file matches on both sides.')
