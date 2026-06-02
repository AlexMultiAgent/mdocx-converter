"""
Smoke tests for md2docx conversion pipeline.
Run outside Dify to verify core logic works.
"""
import os
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
        assert detect_language("你好世界" * 10) == "chinese"

    def test_mixed_mostly_english(self):
        # Single CJK char among many Latin chars should stay English
        assert detect_language("Hello " + "你" + " world! This is a long English sentence.") == "english"


class TestNormalizeProfile:
    def test_valid_profiles(self):
        assert normalize_profile("academic") == "academic"
        assert normalize_profile("technical") == "technical"
        assert normalize_profile("business") == "business"
        assert normalize_profile("government") == "government"
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
        for profile in ["academic", "technical", "business", "government", "template"]:
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

    def test_enabled_renders_or_preserves(self, md_with_mermaid):
        processed, count, temp_dir, errors = preprocess_mermaid(md_with_mermaid, enabled=True)
        try:
            if count == 1:
                assert "Mermaid Diagram" in processed
            else:
                assert "```mermaid" in processed
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
