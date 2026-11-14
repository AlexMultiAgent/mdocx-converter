"""
Regression tests for the DOCX style-override layer.

The overrides must resolve styles by *display name* (the ``w:name`` value),
never by style id: ids differ between templates, and two of the legacy ids
(``a`` / ``a1``) belong to completely unrelated styles — *List Number* and
*Normal Table* — so an id-based lookup puts the body font on the wrong style.

The fixtures below reproduce the two template shapes that ship with the
plugin: the regenerated templates (ids ``Normal`` / ``Heading1`` …) and the
legacy Word templates (ids ``a`` / ``a1`` / ``1`` / ``21`` / ``31`` …).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from docx import Document
from docx.oxml.ns import qn

from md2docx import (
    CJK_CHAR_RE,
    PROFILE_DEFAULTS,
    TEMPLATE_MAP,
    _profile_metadata,
    _resolve_line_spacing,
    apply_style_overrides,
    detect_language,
)


# ── Fixtures ─────────────────────────────────────────────────

# Style ids of the legacy Chinese reference templates.
LEGACY_STYLE_IDS = {
    "Normal": "a1",
    "Body Text": "af",
    "List Number": "a",
    "Normal Table": "a3",
    "Heading 1": "1",
    "Heading 2": "21",
    "Heading 3": "31",
}


def _style_by_name(doc, display_name):
    """Return the style whose display name is *display_name*."""
    for style in doc.styles:
        if style.name == display_name:
            return style
    raise AssertionError(f"style {display_name!r} not found in document")


def _make_regenerated_template_doc():
    """A document shaped like the regenerated templates.

    python-docx's default template already stores the built-in headings under
    the OOXML spelling ``heading 1`` with the ids ``Normal`` / ``Heading1``,
    which is exactly the shape of the regenerated reference templates.
    """
    return Document()


def _make_legacy_template_doc():
    """A document shaped like the legacy reference templates."""
    doc = Document()
    for display_name, style_id in LEGACY_STYLE_IDS.items():
        _style_by_name(doc, display_name).style_id = style_id
    return doc


def _raw_name(style):
    """Return the raw ``w:name`` value of a style (no BabelFish translation)."""
    name_el = style._element.find(qn("w:name"))
    return name_el.get(qn("w:val")) if name_el is not None else None


def _rfonts(style):
    """Return the ``w:rFonts`` element of a style, or None."""
    rPr = style._element.find(qn("w:rPr"))
    if rPr is None:
        return None
    return rPr.find(qn("w:rFonts"))


def _font_slots(style):
    """Return the (ascii, eastAsia) font names of a style."""
    rFonts = _rfonts(style)
    if rFonts is None:
        return (None, None)
    return (rFonts.get(qn("w:ascii")), rFonts.get(qn("w:eastAsia")))


def _size_halves(style):
    """Return the ``w:sz`` value of a style, in half-points, or None."""
    rPr = style._element.find(qn("w:rPr"))
    if rPr is None:
        return None
    sz = rPr.find(qn("w:sz"))
    return sz.get(qn("w:val")) if sz is not None else None


def _spacing(style):
    """Return the (line, lineRule) of a style's paragraph spacing, or None."""
    pPr = style._element.find(qn("w:pPr"))
    if pPr is None:
        return None
    spacing = pPr.find(qn("w:spacing"))
    if spacing is None:
        return None
    return (spacing.get(qn("w:line")), spacing.get(qn("w:lineRule")))


# ── 1. Heading overrides hit styles named "heading 1" ─────────

class TestHeadingLookup:
    @pytest.mark.parametrize(
        "doc_factory",
        [_make_regenerated_template_doc, _make_legacy_template_doc],
        ids=["regenerated-template", "legacy-template"],
    )
    def test_heading_override_hits_lowercase_heading_name(self, doc_factory):
        """The template spells the heading ``heading 1`` — the override must
        still find it and write the profile's fonts onto it."""
        doc = doc_factory()
        h1 = _style_by_name(doc, "Heading 1")
        # Precondition: the raw name really is the lowercase OOXML spelling.
        assert _raw_name(h1) == "heading 1"

        warnings = apply_style_overrides(doc, "academic", {})

        assert warnings == [], f"unexpected warnings: {warnings}"
        ascii, east_asia = _font_slots(h1)
        assert ascii == "Times New Roman"
        assert east_asia == "SimHei"
        assert _size_halves(h1) == "32"  # 16pt

    def test_all_three_heading_levels_are_matched(self):
        doc = _make_legacy_template_doc()
        apply_style_overrides(doc, "academic", {})
        for name, size in (("Heading 1", "32"), ("Heading 2", "28"), ("Heading 3", "24")):
            style = _style_by_name(doc, name)
            ascii, east_asia = _font_slots(style)
            assert ascii == "Times New Roman", name
            assert east_asia == "SimHei", name
            assert _size_halves(style) == size, name


# ── 2. Body overrides must not land on List Number / Normal Table ──

class TestBodyStyleIsolation:
    def test_body_override_does_not_touch_list_number_or_normal_table(self):
        """In the legacy templates the ids ``a`` / ``a1`` / ``a3`` belong to
        *List Number* / *Normal Table*, not to the body style."""
        doc = _make_legacy_template_doc()

        apply_style_overrides(doc, "academic", {})

        for name in ("List Number", "Normal Table"):
            style = _style_by_name(doc, name)
            ascii, east_asia = _font_slots(style)
            assert ascii != "Times New Roman", f"{name} received the body font"
            assert east_asia != "SimSun", f"{name} received the body font"

        # ... while the real body style did get it.
        normal = _style_by_name(doc, "Normal")
        assert _font_slots(normal) == ("Times New Roman", "SimSun")

    def test_body_override_reaches_normal_in_regenerated_template(self):
        doc = _make_regenerated_template_doc()
        apply_style_overrides(doc, "academic", {})
        normal = _style_by_name(doc, "Normal")
        assert _font_slots(normal) == ("Times New Roman", "SimSun")


# ── 3. w:ascii and w:eastAsia are written separately ─────────

class TestFontSlots:
    def test_ascii_and_east_asia_fonts_are_distinct(self):
        doc = _make_regenerated_template_doc()
        apply_style_overrides(doc, "academic", {})

        normal = _style_by_name(doc, "Normal")
        ascii, east_asia = _font_slots(normal)
        assert ascii == "Times New Roman"
        assert east_asia == "SimSun"
        assert ascii != east_asia

        h1 = _style_by_name(doc, "Heading 1")
        assert _font_slots(h1) == ("Times New Roman", "SimHei")

    def test_explicit_user_font_fills_both_slots(self):
        """An explicit font overrides both slots, like the VS Code side."""
        doc = _make_regenerated_template_doc()
        apply_style_overrides(doc, "academic", {"body_font": "Georgia"})

        normal = _style_by_name(doc, "Normal")
        assert _font_slots(normal) == ("Georgia", "Georgia")

    def test_profile_defaults_expose_both_slots(self):
        for profile in ("academic", "business", "technical", "official", "thesis"):
            defaults = PROFILE_DEFAULTS[profile]
            assert defaults["body_ascii_font"]
            assert defaults["body_east_asia_font"]
            for level in (1, 2, 3):
                assert defaults[f"heading{level}_ascii_font"]
                assert defaults[f"heading{level}_east_asia_font"]
            # The old single-font keys must be gone.
            assert "body_font" not in defaults
            assert "heading1_font" not in defaults


# ── 4. The official profile uses a fixed line height ─────────

class TestOfficialLineSpacing:
    def test_official_profile_writes_exact_line_spacing(self):
        doc = _make_regenerated_template_doc()
        apply_style_overrides(doc, "official", {})

        normal = _style_by_name(doc, "Normal")
        assert _spacing(normal) == ("580", "exact")

    def test_official_defaults_declare_twips_not_a_multiplier(self):
        official = PROFILE_DEFAULTS["official"]
        assert official["line_spacing_twips"] == 580
        assert official["line_spacing_rule"] == "exact"
        assert "line_spacing" not in official

    def test_resolve_line_spacing_prefers_twips(self):
        assert _resolve_line_spacing(PROFILE_DEFAULTS["official"], None) == (580, "exact")
        assert _resolve_line_spacing(PROFILE_DEFAULTS["academic"], None) == (360, "auto")
        # A user-supplied multiplier wins over the preset.
        assert _resolve_line_spacing(PROFILE_DEFAULTS["official"], 2.0) == (480, "auto")

    def test_official_pandoc_metadata_carries_no_linestretch(self):
        metadata = _profile_metadata("official")
        assert "linestretch" not in metadata
        assert metadata["mainfont"] == "Times New Roman"
        assert metadata["CJKmainfont"] == "FangSong"


# ── 5. The CJK range must not swallow Hangul ─────────────────

class TestCjkRange:
    def test_hangul_syllables_are_not_cjk(self):
        hangul = "\uac00\ub098\ub2e4\ub098\ub9e4\ubc14\uc0ac\uc544\uc790\ucc28\uce74\ud0c0\ud30c\ud558"
        assert all(0xAC00 <= ord(ch) <= 0xD7AF for ch in hangul)
        assert CJK_CHAR_RE.search(hangul) is None

    def test_yi_syllables_are_not_cjk(self):
        yi = "\ua000\ua001\ua002"
        assert all(0xA000 <= ord(ch) <= 0xA48F for ch in yi)
        assert CJK_CHAR_RE.search(yi) is None

    def test_han_and_compatibility_ideographs_are_cjk(self):
        assert CJK_CHAR_RE.search("\u4e2d\u6587") is not None
        assert CJK_CHAR_RE.search("\u3400") is not None  # U+3400, ext-A
        assert CJK_CHAR_RE.search("\ufaff") is not None  # U+FAFF, compat ideographs

    def test_korean_document_is_detected_as_english(self):
        assert detect_language("\uac00\ub098\ub2e4\ub098\ub9e4\ubc14\uc0ac\uc544\uc790\ucc28\uce74\ud0c0\ud30c\ud558" * 10) == "english"
        assert detect_language("\u8fd9\u662f\u4e00\u6bb5\u4e2d\u6587\u6587\u6863\u3002" * 10) == "chinese"


# ── 6. The thesis profile has its own templates ──────────────

class TestThesisTemplateMap:
    def test_thesis_points_at_its_own_templates(self):
        assert TEMPLATE_MAP["thesis"]["english"] == "reference_english_thesis.docx"
        assert TEMPLATE_MAP["thesis"]["chinese"] == "reference_chinese_thesis.docx"

    def test_thesis_templates_are_shipped(self):
        templates_dir = os.path.join(
            os.path.dirname(__file__), "..", "multi-templates"
        )
        for filename in (
            "reference_english_thesis.docx",
            "reference_chinese_thesis.docx",
        ):
            assert os.path.exists(os.path.join(templates_dir, filename)), filename
