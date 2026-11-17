"""
Smoke tests for md2docx conversion pipeline.
Run outside Dify to verify core logic works.
"""
import os
import re
import sys
import shutil

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from md2docx import (
    detect_language,
    resolve_template,
    preprocess_mermaid,
    build_pandoc_metadata,
    _ensure_pandoc,
    sanitize_filename,
    _coerce_bool,
    _map_pandoc_error,
    normalize_profile,
)


class TestLanguageDetection:
    def test_english(self):
        assert detect_language("Hello world") == "english"

    def test_chinese(self):
        assert detect_language("\u4f60\u597d\u4e16\u754c" * 10) == "chinese"

    def test_mixed_mostly_english(self):
        # Single CJK char among many Latin chars should stay English
        assert detect_language("Hello " + "\u4f60" + " world! This is a long English sentence.") == "english"

    def test_korean_is_not_chinese(self):
        """Hangul syllables sit inside the U+8C48-U+FAFF span but are not Chinese."""
        korean = "\uac08\ub155\ud558\uc138\uc694\ubc18\uac11\uc2b5\ub2c8\ub2e4"
        assert detect_language(korean + " " * 10) == "english"

    def test_yi_is_not_chinese(self):
        """Yi syllables sit inside the same span."""
        yi = "".join(chr(code) for code in range(0xA000, 0xA00A))
        assert detect_language(yi + " " * 10) == "english"

    def test_cjk_compatibility_ideographs_are_chinese(self):
        """U+F900-U+FAFF is the CJK compatibility block and must be detected."""
        compat = "\uf900\u66f4\u8eca\u8cc8\u6ed1\u4e32"
        assert detect_language(compat + " " * 10) == "chinese"

    def test_cjk_extension_a_is_chinese(self):
        """U+3400-U+4DBF is the CJK extension A block."""
        ext_a = "".join(chr(code) for code in range(0x3400, 0x340A))
        assert detect_language(ext_a + " " * 10) == "chinese"


class TestCjkCharacterRange:
    """The CJK range must be pinned with explicit escapes.

    Written as literal characters the lower bound silently became U+8C48
    instead of U+F900, which swallowed Hangul and Yi syllables and made
    Korean documents pick the Chinese template here while the VS Code
    extension (which uses explicit escapes) picked the English one.

    Every boundary below is written as an escape for the same reason the
    implementation must be: U+F900 and U+8C48 render as near-identical
    glyphs and cannot be told apart by eye.
    """

    # CJK Extension A, CJK Unified Ideographs, CJK Compatibility Ideographs
    CJK_BLOCKS = (
        "\u3400", "\u4dbf",
        "\u4e00", "\u9fff",
        "\uf900", "\ufaff",
    )
    OUTSIDE = (
        "\uac00", "\ud7a3",   # Hangul syllables
        "\ua000", "\ua489",   # Yi syllables
        "\uf8ff", "\ufb00",   # just outside the compatibility block
    )

    def test_the_cjk_blocks_are_inside_the_range(self):
        from md2docx import CJK_CHAR_RE

        for char in self.CJK_BLOCKS:
            assert CJK_CHAR_RE.search(char) is not None, (
                f"U+{ord(char):04X} should match"
            )

    def test_the_neighbouring_scripts_are_outside_the_range(self):
        from md2docx import CJK_CHAR_RE

        for char in self.OUTSIDE:
            assert CJK_CHAR_RE.search(char) is None, (
                f"U+{ord(char):04X} should not match"
            )

    def test_the_range_matches_the_vs_code_extension(self):
        """Both ends must classify a document the same way."""
        from md2docx import CJK_CHAR_RE

        vs_code_range = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
        for code_point in range(0x3000, 0xFB00):
            char = chr(code_point)
            assert bool(CJK_CHAR_RE.search(char)) == bool(vs_code_range.search(char)), (
                f"U+{code_point:04X} differs from the VS Code extension"
            )


class TestNormalizeProfile:
    def test_valid_profiles(self):
        assert normalize_profile("academic") == "academic"
        assert normalize_profile("thesis") == "thesis"
        assert normalize_profile("technical") == "technical"
        assert normalize_profile("business") == "business"
        assert normalize_profile("official") == "official"
        assert normalize_profile("template") == "template"

    def test_none_falls_back_to_template(self):
        assert normalize_profile(None) == "template"

    def test_empty_string_falls_back_to_template(self):
        assert normalize_profile("") == "template"

    def test_unknown_value_falls_back_to_template(self):
        assert normalize_profile("invalid_profile") == "template"
        assert normalize_profile("random") == "template"


class TestTemplateResolution:
    def test_resolves_builtin_template(self):
        plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        path = resolve_template("academic", "chinese", None, plugin_root)
        assert os.path.exists(path), f"Template not found: {path}"
        assert "chinese_academic" in os.path.basename(path)

    def test_all_profiles_have_templates(self):
        plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for profile in ["academic", "thesis", "technical", "business", "official", "template"]:
            for lang in ["english", "chinese"]:
                path = resolve_template(profile, lang, None, plugin_root)
                assert os.path.exists(path), f"Missing: profile={profile}, lang={lang}"


class TestMermaidPreprocessing:
    @pytest.fixture
    def md_with_mermaid(self):
        return """# Test Doc

```mermaid
graph TD
    A --> B
```

Some text after.
"""

    def test_enabled_renders_or_preserves(self, md_with_mermaid, monkeypatch):
        # Mock the Mermaid Ink API so this test is hermetic and fast.
        from md2docx import preprocess_mermaid
        monkeypatch.setattr(
            "md2docx.render_mermaid_via_api",
            lambda diagram, api_url=None, timeout=None: b"\x89PNG\r\n\x1a\n" + b"\x00" * 16,
        )
        monkeypatch.setattr("md2docx.time.sleep", lambda s: None)
        processed, count, temp_dir, errors = preprocess_mermaid(md_with_mermaid, enabled=True)
        try:
            assert count == 1
            assert "Mermaid Diagram" in processed
            assert errors == []
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

    def test_disabled_preserves_code_block(self, md_with_mermaid):
        processed, count, _, _ = preprocess_mermaid(md_with_mermaid, enabled=False)
        assert count == 0
        assert "```mermaid" in processed

    def test_no_mermaid_blocks_returns_unchanged(self):
        md = "# Just a doc\n\nSome text."
        processed, count, temp_dir, errors = preprocess_mermaid(md, enabled=True)
        try:
            assert count == 0
            assert processed == md
            assert errors == []
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)


class TestPandocMetadata:
    def test_academic_metadata(self):
        meta = build_pandoc_metadata("academic", None, None, None)
        assert meta["mainfont"] == "Times New Roman"

    def test_user_override(self):
        meta = build_pandoc_metadata("academic", "Arial", 14.0, 2.0)
        assert meta["mainfont"] == "Arial"
        assert meta["fontsize"] == "14.0pt"
        assert meta["linestretch"] == "2.0"


class TestSanitizeFilename:
    def test_replaces_bad_chars(self):
        assert sanitize_filename("Report: Q1/2025") == "Report_ Q1_2025"
        assert sanitize_filename("a/b:c") == "a_b_c"

    def test_empty_returns_document(self):
        assert sanitize_filename("") == "Document"
        assert sanitize_filename("   ") == "Document"

    def test_windows_reserved_names_and_trailing_dots_are_sanitized(self):
        assert sanitize_filename("CON") == "_CON"
        assert sanitize_filename("con.txt") == "_con.txt"
        assert sanitize_filename("report... ") == "report"
        assert sanitize_filename("...") == "Document"


class TestCoerceBool:
    def test_bool_inputs(self):
        assert _coerce_bool(True) is True
        assert _coerce_bool(False) is False

    def test_string_true_variants(self):
        assert _coerce_bool("true") is True
        assert _coerce_bool("TRUE") is True

    def test_string_false_variants(self):
        assert _coerce_bool("false") is False
        assert _coerce_bool("0") is False
        assert _coerce_bool("no") is False
        assert _coerce_bool("NO") is False
        assert _coerce_bool("") is False
        assert _coerce_bool("off") is False
        assert _coerce_bool("disabled") is False
        assert _coerce_bool("n") is False

    def test_numeric_inputs(self):
        assert _coerce_bool(1) is True
        assert _coerce_bool(0) is False


class TestPandocErrorMapping:
    def test_permission_error(self):
        assert "Close the target DOCX" in _map_pandoc_error("Permission denied")

    def test_image_error(self):
        assert "image" in _map_pandoc_error("Cannot decode image: logo.png")

    def test_syntax_error(self):
        assert "syntax" in _map_pandoc_error("Unknown extension: .xyz")

    def test_template_error(self):
        assert "reference template" in _map_pandoc_error("not a valid docx file")

    def test_fallback_message(self):
        assert "Pandoc conversion failed" in _map_pandoc_error("Some random error")


class TestPandocAvailable:
    @pytest.mark.slow
    def test_pandoc_binary_available(self):
        _ensure_pandoc()
        import pypandoc
        ver = pypandoc.get_pandoc_version()
        assert ver is not None
