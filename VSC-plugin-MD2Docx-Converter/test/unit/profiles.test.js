const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    PROFILE_PRESETS,
    TEMPLATE_LAYOUT,
    normalizeStyleProfile,
    resolveFontPair,
    resolveLineSpacingTwips,
    buildPandocMetadata,
    resolveMarginsMm,
    STYLE_PROFILES
} = require('../../out/profiles.js');
const { BUNDLED_REFERENCE_DOCX, getBundledReferenceDocxCandidates } = require('../../out/templates.js');

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

test('business and technical line spacing matches the Dify plugin', () => {
    assert.equal(PROFILE_PRESETS.business.lineSpacing, 1.5);
    assert.equal(PROFILE_PRESETS.technical.lineSpacing, 1.35);
});

test('official uses an exact 29pt line height', () => {
    assert.equal(PROFILE_PRESETS.official.lineSpacingTwips, 580);
    assert.equal(PROFILE_PRESETS.official.lineSpacingRule, 'exact');
});

test('template layout covers every profile that has one', () => {
    for (const name of STYLE_PROFILES) {
        const layout = TEMPLATE_LAYOUT[name];
        if (!layout) {
            continue;
        }

        assert.ok(layout.indentTwips.chinese >= 0);
        assert.ok(layout.indentTwips.english >= 0);
        assert.equal(layout.headingAlign.length, 3);
        assert.equal(layout.headingBeforeTwips.length, 3);
        assert.equal(layout.headingAfterTwips.length, 3);
        assert.ok(layout.pageNumberFont, `${name} must name a page-number font`);
        assert.ok(layout.pageNumberSizePt > 0, `${name} must size the page number`);
    }

    assert.ok(TEMPLATE_LAYOUT.academic);
    assert.ok(TEMPLATE_LAYOUT.business);
    assert.ok(TEMPLATE_LAYOUT.technical);
    assert.ok(TEMPLATE_LAYOUT.official);
    assert.ok(TEMPLATE_LAYOUT.thesis);
});

test('the template preset is empty so it applies no overrides', () => {
    assert.deepEqual(PROFILE_PRESETS.template, {});
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

test('the code style lives in the preset, not in the consumer', () => {
    assert.equal(PROFILE_PRESETS.technical.codeStyle.font, 'Consolas');
    assert.equal(PROFILE_PRESETS.technical.codeStyle.shadingFill, 'F3F4F6');
});

test('every profile that owns a template declares a code style', () => {
    for (const name of ['academic', 'business', 'technical', 'official', 'thesis']) {
        const codeStyle = PROFILE_PRESETS[name].codeStyle;
        assert.ok(codeStyle, `${name} must declare a code style`);
        assert.ok(codeStyle.font, `${name} code style must name a font`);
        assert.ok(codeStyle.sizePt > 0, `${name} code style must size the text`);
        assert.ok(codeStyle.lineSpacing > 0, `${name} code style must space the lines`);
    }
});

test('every profile that owns a template declares a line spacing rule', () => {
    for (const name of ['academic', 'business', 'technical', 'official', 'thesis']) {
        assert.ok(PROFILE_PRESETS[name].lineSpacingRule, `${name} must declare a line spacing rule`);
    }
});

test('normalizeStyleProfile trims and lowercases', () => {
    assert.equal(normalizeStyleProfile(' Official '), 'official');
    assert.equal(normalizeStyleProfile('THESIS'), 'thesis');
    assert.equal(normalizeStyleProfile('nonsense'), 'template');
});

test('resolveFontPair lets an explicit font win and fill both slots', () => {
    assert.deepEqual(resolveFontPair('Arial', { ascii: 'Times New Roman', eastAsia: 'SimSun' }), { ascii: 'Arial', eastAsia: 'Arial' });
});

test('resolveFontPair falls back to the preset for blank input', () => {
    const presetPair = { ascii: 'Times New Roman', eastAsia: 'SimSun' };
    assert.deepEqual(resolveFontPair('', presetPair), presetPair);
    assert.deepEqual(resolveFontPair('   ', presetPair), presetPair);
    assert.deepEqual(resolveFontPair(undefined, presetPair), presetPair);
    assert.equal(resolveFontPair(undefined, undefined), undefined);
});

test('resolveLineSpacingTwips prefers the user value', () => {
    assert.deepEqual(resolveLineSpacingTwips('official', 2), { twips: 480, rule: 'auto' });
});

test('resolveLineSpacingTwips uses the preset exact height when there is one', () => {
    assert.deepEqual(resolveLineSpacingTwips('official'), { twips: 580, rule: 'exact' });
});

test('resolveLineSpacingTwips falls back to the preset multiple', () => {
    assert.deepEqual(resolveLineSpacingTwips('academic'), { twips: 360, rule: 'auto' });
    assert.deepEqual(resolveLineSpacingTwips('technical'), { twips: 324, rule: 'auto' });
});

test('resolveLineSpacingTwips yields nothing for the template profile', () => {
    assert.equal(resolveLineSpacingTwips('template'), undefined);
});

test('buildPandocMetadata derives everything from the typed fields', () => {
    assert.deepEqual(buildPandocMetadata({ profile: 'academic' }), {
        mainfont: 'Times New Roman',
        CJKmainfont: 'SimSun',
        fontsize: '12pt',
        linestretch: '1.5'
    });
});

test('buildPandocMetadata splits latin and CJK fonts', () => {
    const metadata = buildPandocMetadata({ profile: 'academic' });
    assert.equal(metadata.mainfont, 'Times New Roman');
    assert.equal(metadata.CJKmainfont, 'SimSun');
});

test('buildPandocMetadata honours explicit user overrides', () => {
    const metadata = buildPandocMetadata({ profile: 'academic', bodyFont: 'Arial', bodySizePt: 14, lineSpacing: 2 });
    assert.equal(metadata.mainfont, 'Arial');
    assert.equal(metadata.CJKmainfont, 'Arial');
    assert.equal(metadata.fontsize, '14pt');
    assert.equal(metadata.linestretch, '2');
});

test('buildPandocMetadata adds the monospace font only when the preset has one', () => {
    assert.equal(buildPandocMetadata({ profile: 'technical' }).monofont, 'Consolas');
    assert.equal(buildPandocMetadata({ profile: 'academic' }).monofont, undefined);
});

test('buildPandocMetadata yields nothing for the template profile', () => {
    assert.deepEqual(buildPandocMetadata({ profile: 'template' }), {});
});

test('resolveMarginsMm falls back to the preset margins', () => {
    assert.deepEqual(resolveMarginsMm('official', {}), { top: 37, bottom: 35, left: 28, right: 26 });
});

test('resolveMarginsMm lets an explicit margin win', () => {
    assert.deepEqual(resolveMarginsMm('official', { top: 10 }), { top: 10, bottom: 35, left: 28, right: 26 });
});

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

test('every mapped bundled template file exists', () => {
    for (const [profile, languages] of Object.entries(BUNDLED_REFERENCE_DOCX)) {
        for (const [language, relativePath] of Object.entries(languages)) {
            const file = path.join(__dirname, '..', '..', relativePath);
            assert.ok(fs.existsSync(file), `missing ${profile}/${language}: ${relativePath}`);
        }
    }
});
