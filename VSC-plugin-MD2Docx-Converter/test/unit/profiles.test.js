const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILE_PRESETS, TEMPLATE_LAYOUT, normalizeStyleProfile, STYLE_PROFILES } = require('../../out/profiles.js');
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

test('pandoc metadata and docx defaults agree on line spacing', () => {
    for (const [name, preset] of Object.entries(PROFILE_PRESETS)) {
        if (name === 'template' || preset.lineSpacing === undefined) {
            continue;
        }
        assert.equal(preset.metadata.linestretch, String(preset.lineSpacing), `${name} linestretch`);
    }
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
    assert.deepEqual(template.metadata, {});
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
