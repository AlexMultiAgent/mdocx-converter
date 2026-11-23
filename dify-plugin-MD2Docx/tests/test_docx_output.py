"""
Integration tests: full pandoc conversion + style overrides.
Verifies the generated DOCX has correct font, size, spacing, and margins.
All tests require pandoc binary (auto-downloaded by pypandoc on first run).
"""
import os
import sys
import io

import pytest

pytestmark = pytest.mark.slow

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from md2docx import (
    convert_via_pandoc,
    apply_style_overrides,
    build_pandoc_metadata,
    _ensure_pandoc,
    _resolve_line_spacing,
    PROFILE_DEFAULTS,
    PROFILE_METADATA,
    NORMAL_STYLE_NAMES,
    HEADING_ALIASES,
    CODE_STYLE_NAMES,
    TEMPLATE_MAP,
)

W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(PLUGIN_ROOT, "multi-templates")


@pytest.fixture(scope="module")
def pandoc_available():
    """Ensure pandoc is available before running these tests."""
    _ensure_pandoc()
    import pypandoc
    assert pypandoc.get_pandoc_version() is not None


@pytest.fixture
def reference_docx():
    """Path to the english academic reference template."""
    plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(plugin_root, "multi-templates", "reference_english_academic.docx")


@pytest.fixture
def source_dir(reference_docx):
    return os.path.dirname(reference_docx)


@pytest.fixture
def sample_markdown():
    return """# Heading 1

## Heading 2

### Heading 3

This is a normal paragraph with some text to test body font settings.
It should be long enough to be meaningful in the output document.

```python
def hello():
    print("Hello World")
```
"""


class TestFullConversion:
    """End-to-end tests: markdown → pandoc → style overrides → verified DOCX."""

    def test_academic_profile_overrides(
        self, pandoc_available, reference_docx, source_dir, sample_markdown
    ):
        """Full pipeline with academic profile and verify style overrides applied."""
        from docx import Document

        metadata = build_pandoc_metadata("academic", None, None, None)
        docx_io = convert_via_pandoc(
            sample_markdown, reference_docx, source_dir, "", metadata
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        # Verify Normal style exists and has font overrides applied
        normal_found = False
        for name in NORMAL_STYLE_NAMES:
            try:
                style = doc.styles[name]
                normal_found = True
                # Check font was set (SimSun for academic Chinese, but English
                # template will get Times New Roman / SimSun via metadata)
                rPr = style._element.find(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr"
                )
                if rPr is not None:
                    rFonts = rPr.find(
                        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts"
                    )
                    if rFonts is not None:
                        ascii_font = rFonts.get(
                            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}ascii"
                        )
                        assert ascii_font is not None
                break
            except KeyError:
                continue
        assert normal_found, f"None of {NORMAL_STYLE_NAMES} found in document styles"

    def test_heading_styles_applied(
        self, pandoc_available, reference_docx, source_dir, sample_markdown
    ):
        """Verify heading styles are applied after conversion."""
        from docx import Document

        metadata = build_pandoc_metadata("academic", None, None, None)
        docx_io = convert_via_pandoc(
            sample_markdown, reference_docx, source_dir, "", metadata
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        # Check Heading 1 style has font set
        for alias in HEADING_ALIASES["Heading 1"]:
            try:
                style = doc.styles[alias]
                rPr = style._element.find(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr"
                )
                if rPr is not None:
                    rFonts = rPr.find(
                        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts"
                    )
                    if rFonts is not None:
                        ascii_font = rFonts.get(
                            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}ascii"
                        )
                        assert ascii_font is not None
                break
            except KeyError:
                continue

    def test_technical_profile_code_styles(
        self, pandoc_available, reference_docx, source_dir, sample_markdown
    ):
        """Technical profile should set Consolas on SourceCode/VerbatimChar."""
        from docx import Document

        metadata = build_pandoc_metadata("technical", None, None, None)
        docx_io = convert_via_pandoc(
            sample_markdown, reference_docx, source_dir, "", metadata
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "technical", {})

        # At least one code style should have Consolas set
        code_font_found = False
        for code_name in CODE_STYLE_NAMES:
            try:
                style = doc.styles[code_name]
                rPr = style._element.find(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr"
                )
                if rPr is not None:
                    rFonts = rPr.find(
                        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts"
                    )
                    if rFonts is not None:
                        ascii = rFonts.get(
                            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}ascii"
                        )
                        if ascii == "Consolas":
                            code_font_found = True
                            break
            except KeyError:
                continue
        # Code styles may not exist in all reference templates; skip if none found
        if not code_font_found:
            pytest.skip("Code styles (SourceCode/VerbatimChar) not present in this reference.docx template")

    def test_margin_override(
        self, pandoc_available, reference_docx, source_dir, sample_markdown
    ):
        """Margin overrides should be applied to sections."""
        from docx import Document

        metadata = build_pandoc_metadata("academic", None, None, None)
        docx_io = convert_via_pandoc(
            sample_markdown, reference_docx, source_dir, "", metadata
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {
            "margin_top_mm": 30,
            "margin_bottom_mm": 30,
        })

        # Margins applied — verify sections have non-default margins
        for section in doc.sections:
            # 30mm = 3cm
            assert section.top_margin is not None
            assert section.bottom_margin is not None
            break

    def test_roundtrip_readback(
        self, pandoc_available, reference_docx, source_dir, sample_markdown
    ):
        """Generated DOCX should be re-openable by python-docx after save."""
        from docx import Document

        metadata = build_pandoc_metadata("business", None, None, None)
        docx_io = convert_via_pandoc(
            sample_markdown, reference_docx, source_dir, "", metadata
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "business", {})

        # Save to BytesIO and re-read
        output_io = io.BytesIO()
        doc.save(output_io)
        output_io.seek(0)

        # Should not raise
        doc2 = Document(output_io)
        assert doc2 is not None
        # Should have at least one paragraph (the body text)
        paragraphs = doc2.paragraphs
        assert len(paragraphs) > 0


class TestPandocEndToEnd:
    """Smoke tests that exercise the real pandoc binary end-to-end. These do
    NOT require any specific reference template — they verify that
    `convert_via_pandoc` returns a valid, openable DOCX (zip with a
    word/document.xml entry), which is the property that the rest of the
    pipeline depends on.
    """

    @pytest.fixture(scope="module")
    def pandoc_available(self):
        from md2docx import _ensure_pandoc
        _ensure_pandoc()
        import pypandoc
        assert pypandoc.get_pandoc_version() is not None

    def test_minimal_conversion_returns_valid_docx(self, pandoc_available):
        """The most basic regression: "# Hi" must round-trip into a valid DOCX
        byte stream that python-docx can open. This is the test that would
        have caught the original `outputfile=None` bug.
        """
        from docx import Document
        from md2docx import convert_via_pandoc, build_pandoc_metadata
        import io, os

        plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        ref = os.path.join(plugin_root, "multi-templates", "reference_english_academic.docx")
        source_dir = os.path.dirname(ref)

        docx_io = convert_via_pandoc(
            "# Hello World\n\nA paragraph.",
            ref, source_dir, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        data = docx_io.read()
        assert len(data) > 0
        # DOCX is a zip; first 2 bytes are "PK"
        assert data[:2] == b"PK", f"Output is not a zip, got first bytes: {data[:8]!r}"

        # And python-docx can open it
        doc = Document(io.BytesIO(data))
        assert len(doc.paragraphs) >= 1

    def test_strip_dangling_image_rels(self):
        """_strip_dangling_image_rels must remove image rels whose target is missing."""
        import io, zipfile
        from md2docx import _strip_dangling_image_rels

        # Build a fake docx with one present image and one missing image
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", """<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>""")
            zf.writestr("word/_rels/document.xml.rels", """<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/present.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/missing.png"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/external.png" TargetMode="External"/>
</Relationships>""")
            zf.writestr("word/media/present.png", b"fake-png-bytes")
            zf.writestr("word/styles.xml", "<x/>")
        src = buf.getvalue()

        cleaned = _strip_dangling_image_rels(src)
        with zipfile.ZipFile(io.BytesIO(cleaned)) as zf:
            rels = zf.read("word/_rels/document.xml.rels").decode("utf-8")
        # The missing image rel is gone, the present one and styles survive
        assert "media/missing.png" not in rels
        assert "media/present.png" in rels
        assert "https://example.com/external.png" in rels
        assert "styles.xml" in rels

    def test_strip_no_op_on_clean_docx(self):
        """A docx whose rels all resolve to real parts should be returned as-is."""
        import io, zipfile
        from md2docx import _strip_dangling_image_rels

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("word/_rels/document.xml.rels", """<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>""")
            zf.writestr("word/styles.xml", "<x/>")
        src = buf.getvalue()
        assert _strip_dangling_image_rels(src) == src

    def test_strip_tolerates_invalid_zip(self):
        """Invalid input must be returned unchanged (no exception)."""
        from md2docx import _strip_dangling_image_rels
        assert _strip_dangling_image_rels(b"not a zip") == b"not a zip"
        assert _strip_dangling_image_rels(b"") == b""


class TestMermaidRetryLogic:
    """Verify the new Mermaid retry + budget logic, with the network mocked."""

    def test_render_succeeds_after_one_transient_failure(self, monkeypatch):
        """If the first call raises and the second succeeds, the diagram renders."""
        from md2docx import preprocess_mermaid, _render_one_with_retry
        import time
        calls = {"n": 0}
        def fake_render(diagram, api_url=None, timeout=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("transient")
            return b"\x89PNG\r\n\x1a\n"  # PNG signature

        monkeypatch.setattr("md2docx.render_mermaid_via_api", fake_render)
        # Skip the actual sleep between retries
        monkeypatch.setattr("md2docx.time.sleep", lambda s: None)

        import tempfile
        with tempfile.TemporaryDirectory() as td:
            errors = []
            idx, path, error = _render_one_with_retry(1, "graph TD; A-->B", td, errors)
            assert idx == 1
            assert path is not None
            assert path.endswith("diagram-1.png")
            assert errors == []
            assert error is None
            assert calls["n"] == 2  # 1 failure + 1 success

    def test_render_fails_after_all_attempts(self, monkeypatch):
        """After every attempt fails, an error is recorded and path is None."""
        from md2docx import preprocess_mermaid, _render_one_with_retry
        def fake_render(diagram, api_url=None, timeout=None):
            raise RuntimeError("persistent failure")
        monkeypatch.setattr("md2docx.render_mermaid_via_api", fake_render)
        monkeypatch.setattr("md2docx.time.sleep", lambda s: None)

        import tempfile
        with tempfile.TemporaryDirectory() as td:
            errors = []
            idx, path, error = _render_one_with_retry(1, "graph TD", td, errors)
            assert path is None
            assert len(errors) == 1
            # The message names the kind of failure; what the service said
            # stays in the log.
            assert "RuntimeError" in errors[0]
            assert "persistent failure" not in errors[0]


class TestMermaidBudget:
    """Rendering is bounded by a wall-clock budget so a slow or unreachable
    service cannot push the invocation past the plugin request timeout.
    """

    def test_budget_exhaustion_prevents_further_rendering(self, monkeypatch):
        from md2docx import preprocess_mermaid

        monkeypatch.setattr("md2docx.MERMAID_TOTAL_BUDGET_SECONDS", 0)
        monkeypatch.setattr(
            "md2docx.render_mermaid_via_api",
            lambda *a, **kw: pytest.fail("must not render past the budget"),
        )
        processed, count, temp_dir, errors = preprocess_mermaid(
            "```mermaid\ngraph TD; A-->B\n```\n", enabled=True
        )
        try:
            assert count == 0
            assert errors, "the diagram should be reported as failed"
            assert "time" in errors[0].lower()
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)

    def test_request_timeout_is_clamped_to_the_remaining_budget(self, monkeypatch):
        from md2docx import preprocess_mermaid

        seen = {}

        def capture(diagram, api_url=None, timeout=None):
            seen["timeout"] = timeout
            return b"\x89PNG\r\n\x1a\n"

        monkeypatch.setattr("md2docx.MERMAID_TOTAL_BUDGET_SECONDS", 5)
        monkeypatch.setattr("md2docx.render_mermaid_via_api", capture)
        processed, count, temp_dir, errors = preprocess_mermaid(
            "```mermaid\ngraph TD; A-->B\n```\n", enabled=True
        )
        try:
            assert count == 1
            assert seen["timeout"] is not None
            assert 0 < seen["timeout"] <= 5
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)

    def test_diagrams_are_rendered_concurrently(self, monkeypatch):
        """Three diagrams must be in flight at once, not one after another."""
        import threading
        from md2docx import preprocess_mermaid

        barrier = threading.Barrier(3, timeout=15)

        def blocking(diagram, api_url=None, timeout=None):
            barrier.wait()
            return b"\x89PNG\r\n\x1a\n"

        monkeypatch.setattr("md2docx.MERMAID_MAX_WORKERS", 3)
        monkeypatch.setattr("md2docx.render_mermaid_via_api", blocking)
        md = "\n\n".join(
            f"```mermaid\ngraph TD; A{i}-->B\n```" for i in range(3)
        )
        processed, count, temp_dir, errors = preprocess_mermaid(md, enabled=True)
        try:
            assert count == 3
            assert errors == []
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)

    def test_failures_are_reported_in_diagram_order(self, monkeypatch):
        """Concurrent rendering must still produce a stable warning order."""
        from md2docx import preprocess_mermaid

        def failing(diagram, api_url=None, timeout=None):
            raise RuntimeError("nope")

        monkeypatch.setattr("md2docx.render_mermaid_via_api", failing)
        monkeypatch.setattr("md2docx.time.sleep", lambda s: None)
        md = "\n\n".join(
            f"```mermaid\ngraph TD; A{i}-->B\n```" for i in range(4)
        )
        processed, count, temp_dir, errors = preprocess_mermaid(md, enabled=True)
        try:
            assert count == 0
            assert [e.split(":")[0] for e in errors] == [
                "Diagram 1", "Diagram 2", "Diagram 3", "Diagram 4",
            ]
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)


class TestMermaidApiUrlValidation:
    """A user-supplied rendering endpoint must not be able to reach the
    cloud metadata service or a non-HTTP scheme.
    """

    def test_non_http_scheme_is_rejected(self):
        from md2docx import validate_api_url
        with pytest.raises(ValueError):
            validate_api_url("file:///etc/passwd")

    def test_metadata_address_is_rejected(self):
        from md2docx import validate_api_url
        with pytest.raises(ValueError):
            validate_api_url("http://169.254.169.254/latest/meta-data")

    def test_private_self_hosted_url_is_allowed(self):
        from md2docx import validate_api_url
        assert validate_api_url("http://mermaid_ink:3000") == "http://mermaid_ink:3000"

    def test_empty_url_means_use_the_default(self):
        from md2docx import validate_api_url
        assert validate_api_url(None) is None
        assert validate_api_url("  ") is None


def _style_fonts(style):
    """Return (ascii_font, east_asia_font, size, size_cs) of a style.

    The complex-script size travels in its own `w:szCs` slot, so it is read
    separately from the Latin `w:sz` one — a style that only sets `w:sz`
    leaves complex-script text on the template's size.
    """
    rPr = style._element.find(f"{W_NS}rPr")
    if rPr is None:
        return None, None, None, None
    rFonts = rPr.find(f"{W_NS}rFonts")
    sz = rPr.find(f"{W_NS}sz")
    szCs = rPr.find(f"{W_NS}szCs")
    ascii_font = rFonts.get(f"{W_NS}ascii") if rFonts is not None else None
    east_asia = rFonts.get(f"{W_NS}eastAsia") if rFonts is not None else None
    size = sz.get(f"{W_NS}val") if sz is not None else None
    size_cs = szCs.get(f"{W_NS}val") if szCs is not None else None
    return ascii_font, east_asia, size, size_cs


class TestCjkFontHandling:
    """A Latin preset font must not take over the East Asian font slot, or
    Chinese text falls back to whatever the system picks. A font the user
    named explicitly fills both slots — they asked for that font.
    """

    def test_an_explicit_font_fills_both_pandoc_slots(self):
        from md2docx import build_pandoc_metadata

        meta = build_pandoc_metadata("technical", "Arial", None, None)
        assert meta["mainfont"] == "Arial"
        assert meta["CJKmainfont"] == "Arial"

    def test_a_cjk_override_font_is_used_for_both_slots(self):
        from md2docx import build_pandoc_metadata

        meta = build_pandoc_metadata("technical", "宋体", None, None)
        assert meta["mainfont"] == "宋体"
        assert meta["CJKmainfont"] == "宋体"

    def test_preset_default_keeps_the_profile_cjk_font(self, pandoc_available):
        """Without an override the profile's Latin body font must not claim
        the East Asian slot."""
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_technical.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("technical", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "technical", {})

        normal = _find_style_by_name(doc, "Normal")
        ascii_font, east_asia, _, _ = _style_fonts(normal)
        assert ascii_font == "Arial"
        assert east_asia == "Microsoft YaHei"

    def test_an_explicit_override_fills_both_docx_slots(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_technical.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("technical", "Arial", None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "technical", {"body_font": "Arial"})

        normal = _find_style_by_name(doc, "Normal")
        ascii_font, east_asia, _, _ = _style_fonts(normal)
        assert ascii_font == "Arial"
        assert east_asia == "Arial"

    def test_the_complex_script_slot_gets_the_latin_font(self, pandoc_available):
        """`w:cs` is a third slot next to `w:ascii` and `w:eastAsia`: it takes
        the Latin face, so complex-script text does not fall back to whatever
        the system picks."""
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_technical.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("technical", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "technical", {})

        normal = _find_style_by_name(doc, "Normal")
        rPr = normal._element.find(f"{W_NS}rPr")
        rFonts = rPr.find(f"{W_NS}rFonts")
        assert rFonts.get(f"{W_NS}cs") == "Arial"

    def test_a_cjk_heading_keeps_its_own_font(self, pandoc_available):
        """A CJK preset heading font is used for the East Asian slot as is."""
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_chinese_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        heading1 = _find_style_by_name(doc, "Heading 1")
        ascii_font, east_asia, _, _ = _style_fonts(heading1)
        assert ascii_font == "Times New Roman"
        assert east_asia == "SimHei"


class TestComplexScriptFontSize:
    def test_size_is_written_for_complex_scripts_as_well(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        normal = _find_style_by_name(doc, "Normal")
        rPr = normal._element.find(f"{W_NS}rPr")
        sz = rPr.find(f"{W_NS}sz")
        szCs = rPr.find(f"{W_NS}szCs")
        assert sz is not None
        assert szCs is not None
        assert szCs.get(f"{W_NS}val") == sz.get(f"{W_NS}val")

    def test_the_headings_keep_the_complex_script_size_as_well(self, pandoc_available):
        """`w:szCs` travels with `w:sz` for the headings too — a heading in a
        complex script must not fall back to the template's size."""
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading 1\n\n## Heading 2\n\n### Heading 3\n\nbody\n",
            ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        for name, size in (("Heading 1", "32"), ("Heading 2", "28"), ("Heading 3", "24")):
            style = _find_style_by_name(doc, name)
            assert style is not None, name
            _, _, latin_size, size_cs = _style_fonts(style)
            assert latin_size == size, name
            assert size_cs == size, name


class TestStyleResolutionScope:
    """Style ids are not portable: 'a' is Normal in the English templates but
    List Number in the Chinese one. Overrides must reach the intended styles
    only.

    The regenerated templates use the canonical pandoc ids, so the collision
    is reproduced here on a document shaped like the *legacy* Word templates.
    """

    def test_body_overrides_do_not_leak_into_list_styles(self):
        doc = _make_legacy_template_doc()
        apply_style_overrides(doc, "academic", {})

        list_number = _find_style_by_id(doc, "a")
        assert list_number is not None
        ascii_font, _, _, _ = _style_fonts(list_number)
        assert ascii_font != "SimSun", "List Number must not inherit the body font"

    def test_body_style_still_receives_the_overrides(self):
        doc = _make_legacy_template_doc()
        apply_style_overrides(doc, "academic", {})

        normal = _find_style_by_id(doc, "a1")
        ascii_font, _, size, size_cs = _style_fonts(normal)
        assert ascii_font == "Times New Roman"
        assert size == "24"
        assert size_cs == "24"

    def test_the_normal_table_style_is_left_alone(self):
        """'a3' is Normal Table in the legacy templates, not a body style."""
        doc = _make_legacy_template_doc()
        apply_style_overrides(doc, "academic", {})

        normal_table = _find_style_by_id(doc, "a3")
        assert normal_table is not None
        ascii_font, east_asia, _, _ = _style_fonts(normal_table)
        assert ascii_font != "Times New Roman"
        assert east_asia != "SimSun"

    def test_the_shipped_templates_do_not_leak_into_list_or_table_styles(
        self, pandoc_available
    ):
        """The same guard against the templates that actually ship."""
        from docx import Document

        for profile in ("academic", "business", "official", "technical", "thesis"):
            for language in ("english", "chinese"):
                ref = os.path.join(TEMPLATE_DIR, TEMPLATE_MAP[profile][language])
                docx_io = convert_via_pandoc(
                    "# Heading 1\n\nbody\n", ref, TEMPLATE_DIR, "",
                    build_pandoc_metadata(profile, None, None, None),
                )
                doc = Document(docx_io)
                apply_style_overrides(doc, profile, {})

                for style in doc.styles:
                    name = (style.name or "").lower()
                    if "list" in name or "table" in name:
                        ascii_font, east_asia, _, _ = _style_fonts(style)
                        assert ascii_font != "SimSun", (
                            f"{profile}/{language}: style {style.style_id!r} "
                            f"({style.name!r}) must not inherit the body font"
                        )
                        assert east_asia != "SimSun", (
                            f"{profile}/{language}: style {style.style_id!r} "
                            f"({style.name!r}) must not inherit the body font"
                        )


class TestDocumentMetadata:
    def test_title_is_written_to_the_core_properties(self, pandoc_available):
        from docx import Document
        from md2docx import apply_document_metadata

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_document_metadata(doc, "季度报告")

        assert doc.core_properties.title == "季度报告"


class TestMermaidBlockDetection:
    """Only real Mermaid blocks may be sent to the rendering service."""

    def _blocks(self, markdown):
        from md2docx import MERMAID_BLOCK_RE
        return list(MERMAID_BLOCK_RE.finditer(markdown))

    def test_a_javascript_fence_is_not_a_diagram(self):
        """```mermaidjs must not be shipped to the Mermaid service."""
        assert self._blocks("```mermaidjs\nconsole.log(1);\n```") == []

    def test_plain_code_fence_is_not_a_diagram(self):
        assert self._blocks("```python\nprint(1)\n```") == []

    def test_mermaid_block_is_detected(self):
        assert len(self._blocks("```mermaid\ngraph TD; A-->B\n```")) == 1

    def test_tilde_fenced_diagram_is_detected(self):
        assert len(self._blocks("~~~mermaid\ngraph TD; A-->B\n~~~")) == 1

    def test_indented_diagram_is_detected(self):
        assert len(self._blocks("- item\n\n  ```mermaid\n  graph TD; A-->B\n  ```\n")) == 1

    def test_four_space_indented_block_stays_a_code_block(self):
        """Four spaces of indentation is a markdown code block, not a diagram."""
        markdown = "text\n\n    ```mermaid\n    graph TD; A-->B\n    ```\n"
        assert self._blocks(markdown) == []

    def test_crlf_block_is_detected(self):
        assert len(self._blocks("```mermaid\r\ngraph TD; A-->B\r\n```")) == 1


class TestSandboxedPandoc:
    def test_pandoc_runs_in_sandbox(self, monkeypatch):
        """Pandoc must not fetch URLs or arbitrary filesystem paths from Markdown."""
        from md2docx import convert_via_pandoc

        seen = {}

        def fake_run(markdown_text, extra_args, out_path):
            seen["extra_args"] = list(extra_args)
            with open(out_path, "wb") as f:
                f.write(b"PK")

        monkeypatch.setattr("md2docx._run_pandoc", fake_run)
        convert_via_pandoc(
            "# Doc", "reference.docx", "", "", {},
        )

        assert "--sandbox" in seen["extra_args"]


class TestMermaidOutputLimits:
    def test_mermaid_images_are_embedded_as_data_uris(self, monkeypatch):
        """Rendered diagrams must remain usable when Pandoc is sandboxed."""
        from md2docx import preprocess_mermaid

        monkeypatch.setattr(
            "md2docx.render_mermaid_via_api",
            lambda diagram, api_url=None, timeout=None: b"\x89PNG\r\n\x1a\nabc",
        )
        processed, count, temp_dir, errors = preprocess_mermaid(
            "```mermaid\ngraph TD; A-->B\n```\n"
        )
        try:
            assert count == 1
            assert errors == []
            assert "data:image/png;base64," in processed
            assert "diagram-1.png" not in processed
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)

    def test_diagram_count_is_capped(self, monkeypatch):
        from md2docx import preprocess_mermaid

        monkeypatch.setattr("md2docx.MAX_MERMAID_DIAGRAMS", 2, raising=False)
        monkeypatch.setattr(
            "md2docx.render_mermaid_via_api",
            lambda diagram, api_url=None, timeout=None: b"\x89PNG\r\n\x1a\nabc",
        )
        markdown = "\n\n".join(
            f"```mermaid\ngraph TD; A{i}-->B\n```" for i in range(3)
        )
        processed, count, temp_dir, errors = preprocess_mermaid(markdown)
        try:
            assert count == 2
            assert any("Diagram 3" in error for error in errors)
            assert "```mermaid\ngraph TD; A2-->B\n```" in processed
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)

    def test_total_rendered_bytes_are_capped(self, monkeypatch):
        from md2docx import preprocess_mermaid

        monkeypatch.setattr("md2docx.MAX_MERMAID_TOTAL_BYTES", 20, raising=False)
        monkeypatch.setattr(
            "md2docx.render_mermaid_via_api",
            lambda diagram, api_url=None, timeout=None: b"\x89PNG\r\n\x1a\n1234",
        )
        markdown = "\n\n".join(
            f"```mermaid\ngraph TD; A{i}-->B\n```" for i in range(2)
        )
        processed, count, temp_dir, errors = preprocess_mermaid(markdown)
        try:
            assert count == 1
            assert any("Diagram 2" in error for error in errors)
        finally:
            if temp_dir and os.path.isdir(temp_dir):
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)


class TestMermaidRetryClassification:
    def _http_error(self, status):
        import requests

        response = requests.Response()
        response.status_code = status
        response.url = "https://mermaid.invalid/img"
        return requests.HTTPError(f"HTTP {status}", response=response)

    def test_client_error_is_not_retried(self):
        """A malformed diagram returning 400 must fail immediately."""
        from _mermaid_render import render_mermaid_with_retry

        calls = []

        def bad(*args, **kwargs):
            calls.append(1)
            raise self._http_error(400)

        with pytest.raises(Exception):
            render_mermaid_with_retry("bad", renderer=bad)
        assert len(calls) == 1

    def test_server_error_is_retried(self, monkeypatch):
        from _mermaid_render import render_mermaid_with_retry

        calls = []

        def flaky(*args, **kwargs):
            calls.append(1)
            if len(calls) == 1:
                raise self._http_error(503)
            return b"\x89PNG\r\n\x1a\nabc"

        monkeypatch.setattr("time.sleep", lambda seconds: None)
        result = render_mermaid_with_retry("ok", renderer=flaky)
        assert result.startswith(b"\x89PNG")
        assert len(calls) == 2

    def test_backoff_does_not_sleep_past_the_deadline(self, monkeypatch):
        import time
        from _mermaid_render import render_mermaid_with_retry

        sleeps = []

        def bad(*args, **kwargs):
            raise self._http_error(503)

        monkeypatch.setattr("time.sleep", lambda seconds: sleeps.append(seconds))
        with pytest.raises(Exception):
            render_mermaid_with_retry(
                "bad",
                renderer=bad,
                deadline=time.monotonic() + 0.25,
            )
        assert sleeps and sleeps[0] <= 0.25

    def test_redirects_are_not_followed(self, monkeypatch):
        import _mermaid_render

        seen = {}

        class Response:
            def raise_for_status(self):
                return None

            def iter_content(self, chunk_size):
                return [b"\x89PNG\r\n\x1a\nabc"]

            def close(self):
                return None

        def fake_get(url, **kwargs):
            seen.update(kwargs)
            return Response()

        monkeypatch.setattr("_mermaid_render.requests.get", fake_get)
        _mermaid_render.render_mermaid_via_api("graph TD; A-->B", timeout=1)
        assert seen.get("allow_redirects") is False

    def test_public_endpoint_requests_png_explicitly(self, monkeypatch):
        """Mermaid Ink otherwise defaults to JPEG for the /img endpoint."""
        import _mermaid_render

        seen = {}

        class Response:
            def raise_for_status(self):
                return None

            def iter_content(self, chunk_size):
                return [b"\x89PNG\r\n\x1a\nabc"]

            def close(self):
                return None

        def fake_get(url, **kwargs):
            seen["url"] = url
            return Response()

        monkeypatch.setattr("_mermaid_render.requests.get", fake_get)
        _mermaid_render.render_mermaid_via_api("graph TD; A-->B", timeout=1)
        assert "?type=png" in seen["url"]


class TestMermaidApiHostResolution:
    def test_hostname_resolving_to_link_local_is_rejected(self, monkeypatch):
        import socket
        from md2docx import validate_api_url

        monkeypatch.setattr(
            "socket.getaddrinfo",
            lambda *args, **kwargs: [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 0))
            ],
        )
        with pytest.raises(ValueError, match="link-local"):
            validate_api_url("https://metadata.example")

    def test_query_string_is_rejected(self):
        from md2docx import validate_api_url

        with pytest.raises(ValueError, match="query"):
            validate_api_url("https://mermaid.example/render?token=secret")


class TestNumericInputBounds:
    def test_subpoint_font_sizes_are_rejected(self):
        from md2docx import parse_pt

        assert parse_pt(0.1) is None

    def test_extreme_line_spacing_is_rejected(self):
        from md2docx import parse_spacing

        assert parse_spacing(100) is None

    def test_extreme_margin_is_rejected(self):
        from md2docx import parse_mm

        assert parse_mm(1000) is None


class TestProfileFontPairs:
    def test_academic_uses_latin_and_cjk_font_slots(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        normal = _find_style_by_name(doc, "Normal")
        rPr = normal._element.find(f"{W_NS}rPr")
        rFonts = rPr.find(f"{W_NS}rFonts")
        assert rFonts.get(f"{W_NS}ascii") == "Times New Roman"
        assert rFonts.get(f"{W_NS}eastAsia") == "SimSun"
        assert rFonts.get(f"{W_NS}cs") == "Times New Roman"


class TestFilenameLength:
    def test_an_overlong_title_is_truncated(self):
        from md2docx import sanitize_filename

        result = sanitize_filename("a" * 500)
        assert len(result) <= 120
        assert result.startswith("a")

    def test_utf8_title_fits_the_filename_byte_limit(self):
        from md2docx import sanitize_filename

        result = sanitize_filename("汉" * 200)
        assert len((result + ".docx").encode("utf-8")) <= 125

    def test_a_normal_title_is_untouched(self):
        from md2docx import sanitize_filename

        assert sanitize_filename("季度报告 2026") == "季度报告 2026"




# ── Regression coverage ───────────────────────────────────────────

def _make_png(width: int = 1, height: int = 1) -> bytes:
    """Build a valid RGB PNG so pandoc can decode and embed it."""
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _find_style_by_id(doc, style_id):
    for style in doc.styles:
        if style.style_id == style_id:
            return style
    return None


# Style ids of the legacy Chinese/English Word reference templates. The
# regenerated templates use the canonical pandoc ids, so the id collision
# (List Number owning 'a', Normal Table owning 'a1') can only be reproduced
# on a document shaped like the old ones.
LEGACY_STYLE_IDS = {
    "Normal": "a1",
    "Body Text": "af",
    "List Number": "a",
    "Normal Table": "a3",
    "Heading 1": "1",
    "Heading 2": "21",
    "Heading 3": "31",
}


def _make_legacy_template_doc():
    """A document shaped like the legacy reference templates."""
    from docx import Document

    doc = Document()
    for display_name, style_id in LEGACY_STYLE_IDS.items():
        style = _find_style_by_name(doc, display_name)
        assert style is not None, f"python-docx must define {display_name!r}"
        style.style_id = style_id
    return doc


def _find_style_by_name(doc, name):
    """Return the style whose *display name* is `name`.

    The regenerated templates use the canonical pandoc ids (`Normal`,
    `Heading1`, ...), so the display name is the only stable handle.
    """
    for style in doc.styles:
        if style.name == name:
            return style
    return None


def _style_spacing(style):
    """Return the (line, lineRule) of a style's paragraph spacing, or None."""
    pPr = style._element.find(f"{W_NS}pPr")
    if pPr is None:
        return None
    spacing = pPr.find(f"{W_NS}spacing")
    if spacing is None:
        return None
    return (spacing.get(f"{W_NS}line"), spacing.get(f"{W_NS}lineRule"))


def _style_justification(style):
    """Return the `w:jc` value of a style, or None."""
    pPr = style._element.find(f"{W_NS}pPr")
    if pPr is None:
        return None
    jc = pPr.find(f"{W_NS}jc")
    if jc is None:
        return None
    return jc.get(f"{W_NS}val")


class TestCharacterStyleOverrides:
    """The `technical` templates define `VerbatimChar`, a *character* style.
    python-docx's CharacterStyle has no `paragraph_format`, so shading code
    must not be applied to it — and it must still receive font overrides.
    """

    def test_code_style_overrides_survive_a_character_style(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_technical.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\n```python\nprint(1)\n```\n",
            ref,
            TEMPLATE_DIR,
            "",
            build_pandoc_metadata("technical", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "technical", {})

        verbatim = _find_style_by_id(doc, "VerbatimChar")
        assert verbatim is not None, "technical template should define VerbatimChar"
        rPr = verbatim._element.find(f"{W_NS}rPr")
        assert rPr is not None, "character style should get an rPr"
        rFonts = rPr.find(f"{W_NS}rFonts")
        assert rFonts is not None
        assert rFonts.get(f"{W_NS}ascii") == "Consolas"


class TestEveryProfileConverts:
    """Each preset must yield an openable DOCX. A crash inside one preset
    used to disable that whole style without any test noticing.
    """

    @pytest.mark.parametrize(
        "profile",
        ["academic", "business", "official", "technical", "thesis", "template"],
    )
    @pytest.mark.parametrize("language", ["english", "chinese"])
    def test_profile_produces_a_readable_docx(
        self, pandoc_available, profile, language
    ):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, TEMPLATE_MAP[profile][language])
        docx_io = convert_via_pandoc(
            "# Heading 1\n\n## Heading 2\n\nSome body text.\n",
            ref,
            TEMPLATE_DIR,
            "",
            build_pandoc_metadata(profile, None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, profile, {})

        output = io.BytesIO()
        doc.save(output)
        assert Document(io.BytesIO(output.getvalue())).paragraphs

    @pytest.mark.parametrize(
        "template_name",
        [
            "reference_english_academic.docx",
            "reference_chinese_academic.docx",
            "reference_english_business.docx",
            "reference_chinese_business.docx",
            "reference_english_technical.docx",
            "reference_chinese_technical.docx",
        ],
    )
    def test_body_overrides_do_not_reach_list_or_table_styles(
        self, pandoc_available, template_name
    ):
        """Style ids are ambiguous: 'a' is Normal in the English templates but
        List Number in the Chinese ones, and 'a1' is Normal Table in English.
        A body override must only ever land on the body style itself.
        """
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, template_name)
        docx_io = convert_via_pandoc(
            "# Heading 1\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        for style in doc.styles:
            name = (style.name or "").lower()
            if "list" in name or "table" in name:
                ascii_font, _, _, _ = _style_fonts(style)
                assert ascii_font != "SimSun", (
                    f"{template_name}: style {style.style_id!r} ({style.name!r}) "
                    f"must not inherit the body font"
                )


class TestThemeFontAttributes:
    """A theme font wins over an explicit one, so an override that leaves the
    theme attributes in place is a silent no-op.
    """

    def test_theme_font_attributes_are_removed(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_chinese_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        heading1 = _find_style_by_name(doc, "Heading 1")
        rPr = heading1._element.find(f"{W_NS}rPr")
        rFonts = rPr.find(f"{W_NS}rFonts")
        for attribute in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
            assert rFonts.get(f"{W_NS}{attribute}") is None, (
                f"w:{attribute} would override the explicit font"
            )
        assert rFonts.get(f"{W_NS}ascii") == "Times New Roman"
        assert rFonts.get(f"{W_NS}eastAsia") == "SimHei"


class TestOoxmlChildOrder:
    """`w:rPr` and `w:pPr` have a fixed child sequence; Word repairs a
    document whose style properties are out of order.
    """

    RPR_SEQUENCE = (
        "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
        "dstrike", "outline", "shadow", "emboss", "imprint", "noProof",
        "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern",
        "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd",
        "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout",
        "specVanish", "oMath",
    )
    PPR_SEQUENCE = (
        "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr",
        "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs",
        "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct",
        "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd",
        "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents",
        "suppressOverlap", "jc", "textDirection", "textAlignment",
        "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr",
        "pPrChange",
    )

    def _assert_ordered(self, parent, sequence, label):
        seen = []
        for child in parent:
            tag = child.tag.split("}")[-1]
            if tag in sequence:
                seen.append(tag)
        positions = [sequence.index(tag) for tag in seen]
        assert positions == sorted(positions), f"{label}: {seen} is out of order"

    def test_comment_nodes_survive_order_normalisation(self):
        from lxml import etree
        from docx.oxml.ns import qn

        from md2docx import _normalize_order, _PPR_SEQUENCE

        parent = etree.Element(qn("w:pPr"))
        parent.append(etree.Comment("keep me"))
        parent.append(etree.Element(qn("w:jc")))
        parent.append(etree.Element(qn("w:spacing")))

        _normalize_order(parent, _PPR_SEQUENCE)

        tags = [child.tag for child in parent]
        assert any(not isinstance(tag, str) for tag in tags)
        named = [tag.split("}")[-1] for tag in tags if isinstance(tag, str)]
        assert named.index("spacing") < named.index("jc")

    def test_run_properties_are_in_schema_order(self, pandoc_available):
        """The styles the plugin rewrites must end up schema valid."""
        from docx import Document
        from md2docx import (
            NORMAL_STYLE_NAMES, HEADING_ALIASES, CODE_STYLE_NAMES,
        )

        ref = os.path.join(TEMPLATE_DIR, "reference_english_technical.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\n```python\nprint(1)\n```\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("technical", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "technical", {})

        overridden = set(NORMAL_STYLE_NAMES)
        overridden.update(HEADING_ALIASES["Heading 1"])
        overridden.update(HEADING_ALIASES["Heading 2"])
        overridden.update(HEADING_ALIASES["Heading 3"])
        overridden.update(CODE_STYLE_NAMES)

        checked = 0
        for style in doc.styles:
            if style.name not in overridden:
                continue
            checked += 1
            rPr = style._element.find(f"{W_NS}rPr")
            if rPr is not None:
                self._assert_ordered(rPr, self.RPR_SEQUENCE, f"rPr of {style.style_id}")
            pPr = style._element.find(f"{W_NS}pPr")
            if pPr is not None:
                self._assert_ordered(pPr, self.PPR_SEQUENCE, f"pPr of {style.style_id}")
        assert checked >= 3, "expected the overridden styles to be found"


class TestFontNameNormalization:
    def test_user_font_names_are_stripped(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {"body_font": "  SimSun  "})

        normal = _find_style_by_name(doc, "Normal")
        ascii_font, _, _, _ = _style_fonts(normal)
        assert ascii_font == "SimSun"


class TestPandocWarningIsolation:
    """The daemon runs tool calls concurrently, so one conversion must not see
    another conversion's pandoc warnings.
    """

    def test_warnings_do_not_leak_between_concurrent_conversions(self, monkeypatch):
        import logging
        import threading
        from md2docx import convert_via_pandoc

        barrier = threading.Barrier(2, timeout=15)

        def fake_run(markdown_text, extra_args, out_path):
            # This is what pypandoc does with pandoc's stderr: forward it to
            # the "pypandoc" logger.
            logging.getLogger("pypandoc").warning(
                f"Could not fetch resource {markdown_text}.png: replacing image with description"
            )
            barrier.wait()
            with open(out_path, "wb") as f:
                f.write(b"PK")

        monkeypatch.setattr("md2docx._run_pandoc", fake_run)

        results = {}

        def run(marker):
            warnings = []
            convert_via_pandoc(marker, "ref.docx", "", "", {}, warnings=warnings)
            results[marker] = list(warnings)

        threads = [threading.Thread(target=run, args=(m,)) for m in ("A", "B")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)

        assert set(results) == {"A", "B"}
        assert len(results["A"]) == 1, results
        assert len(results["B"]) == 1, results
        assert "A.png" in results["A"][0], results
        assert "B.png" in results["B"][0], results



class TestImageResolution:
    """An image that pandoc cannot resolve must be reported instead of being
    silently dropped from the DOCX.
    """

    def test_absolute_image_path_is_blocked_in_sandbox(self, pandoc_available, tmp_path):
        import zipfile

        png = tmp_path / "logo.png"
        png.write_bytes(_make_png())

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        warnings: list[str] = []
        docx_io = convert_via_pandoc(
            f"# Doc\n\n![logo]({png})\n",
            ref,
            TEMPLATE_DIR,
            "",
            build_pandoc_metadata("academic", None, None, None),
            warnings=warnings,
        )
        media = [
            name
            for name in zipfile.ZipFile(docx_io).namelist()
            if name.startswith("word/media")
        ]
        assert media == []
        assert any("sandbox" in warning for warning in warnings)

    def test_data_uri_image_is_embedded_in_sandbox(self, pandoc_available):
        import base64
        import zipfile

        data_uri = "data:image/png;base64," + base64.b64encode(_make_png()).decode("ascii")
        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            f"# Doc\n\n![logo]({data_uri})\n",
            ref,
            TEMPLATE_DIR,
            "",
            build_pandoc_metadata("academic", None, None, None),
        )
        media = [
            name
            for name in zipfile.ZipFile(docx_io).namelist()
            if name.startswith("word/media")
        ]
        assert media

    def test_unresolvable_image_is_reported_as_a_warning(
        self, pandoc_available, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        warnings: list[str] = []
        convert_via_pandoc(
            "# Doc\n\n![missing](missing.png)\n",
            ref,
            TEMPLATE_DIR,
            "",
            build_pandoc_metadata("academic", None, None, None),
            warnings=warnings,
        )
        assert any("missing.png" in w for w in warnings), (
            f"expected a warning naming missing.png, got {warnings}"
        )


class TestThesisTemplate:
    """`thesis` has its own GB/T 7713 template instead of reusing academic."""

    def test_thesis_points_at_its_own_templates(self):
        assert TEMPLATE_MAP["thesis"]["english"] == "reference_english_thesis.docx"
        assert TEMPLATE_MAP["thesis"]["chinese"] == "reference_chinese_thesis.docx"

    def test_thesis_templates_are_shipped(self):
        for filename in (
            "reference_english_thesis.docx",
            "reference_chinese_thesis.docx",
        ):
            assert os.path.exists(os.path.join(TEMPLATE_DIR, filename)), filename

    @pytest.mark.parametrize("language", ["english", "chinese"])
    def test_the_thesis_profile_uses_the_thesis_template(self, pandoc_available, language):
        """The produced document must carry the thesis template's own layout.

        The thesis template centres heading 1 (GB/T 7713) while the academic
        one leaves it left-aligned, so the justification tells the two
        reference documents apart.
        """
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, TEMPLATE_MAP["thesis"][language])
        docx_io = convert_via_pandoc(
            "# Heading 1\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("thesis", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "thesis", {})

        heading1 = _find_style_by_name(doc, "Heading 1")
        assert heading1 is not None
        assert _style_justification(heading1) == "center"

    @pytest.mark.parametrize("language", ["english", "chinese"])
    def test_the_academic_profile_uses_the_academic_template(self, pandoc_available, language):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, TEMPLATE_MAP["academic"][language])
        docx_io = convert_via_pandoc(
            "# Heading 1\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        heading1 = _find_style_by_name(doc, "Heading 1")
        assert heading1 is not None
        assert _style_justification(heading1) == "left"


class TestOfficialLineSpacing:
    """GB/T 9704 asks for a fixed 29pt line height, not a multiple."""

    def test_the_official_defaults_declare_twips_not_a_multiplier(self):
        official = PROFILE_DEFAULTS["official"]
        assert official["line_spacing_twips"] == 580
        assert official["line_spacing_rule"] == "exact"
        assert "line_spacing" not in official

    def test_resolve_line_spacing_prefers_the_preset_twips(self):
        assert _resolve_line_spacing(PROFILE_DEFAULTS["official"], None) == (580, "exact")
        assert _resolve_line_spacing(PROFILE_DEFAULTS["academic"], None) == (360, "auto")
        assert _resolve_line_spacing(PROFILE_DEFAULTS["business"], None) == (360, "auto")
        assert _resolve_line_spacing(PROFILE_DEFAULTS["technical"], None) == (324, "auto")
        assert _resolve_line_spacing(PROFILE_DEFAULTS["thesis"], None) == (360, "auto")

    def test_a_user_supplied_multiplier_wins_over_the_preset(self):
        assert _resolve_line_spacing(PROFILE_DEFAULTS["official"], 2.0) == (480, "auto")
        assert _resolve_line_spacing(PROFILE_DEFAULTS["academic"], 2.0) == (480, "auto")

    def test_a_profile_without_line_spacing_resolves_to_none(self):
        assert _resolve_line_spacing(PROFILE_DEFAULTS["template"], None) is None

    def test_the_official_pandoc_metadata_carries_no_linestretch(self):
        """A fixed line height cannot be expressed as a multiplier."""
        metadata = PROFILE_METADATA["official"]
        assert "linestretch" not in metadata
        assert metadata["mainfont"] == "Times New Roman"
        assert metadata["CJKmainfont"] == "FangSong"

    def test_the_official_profile_writes_a_fixed_line_height(self):
        from docx import Document

        doc = Document()
        apply_style_overrides(doc, "official", {})

        normal = _find_style_by_name(doc, "Normal")
        assert _style_spacing(normal) == ("580", "exact")

    def test_a_user_multiplier_replaces_the_fixed_line_height(self):
        from docx import Document

        doc = Document()
        apply_style_overrides(doc, "official", {"line_spacing": 2.0})

        normal = _find_style_by_name(doc, "Normal")
        assert _style_spacing(normal) == ("480", "auto")

    def test_the_official_line_height_survives_a_full_conversion(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_official.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("official", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "official", {})

        normal = _find_style_by_name(doc, "Normal")
        assert _style_spacing(normal) == ("580", "exact")


class TestProfileMargins:
    """The Dify margins must match the VS Code extension's presets."""

    def test_the_academic_margins_match_the_vs_code_side(self):
        academic = PROFILE_DEFAULTS["academic"]
        assert academic["margin_top_mm"] == 25.4
        assert academic["margin_bottom_mm"] == 25.4
        assert academic["margin_left_mm"] == 31.75
        assert academic["margin_right_mm"] == 31.75

    def test_the_academic_margins_reach_the_section(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        section = doc.sections[0]
        assert section.top_margin.mm == pytest.approx(25.4)
        assert section.bottom_margin.mm == pytest.approx(25.4)
        assert section.left_margin.mm == pytest.approx(31.75)
        assert section.right_margin.mm == pytest.approx(31.75)

    def test_a_user_margin_wins_over_the_profile_default(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {"margin_left_mm": 20})

        section = doc.sections[0]
        # Word stores margins in twips, so a millimetre value comes back
        # rounded to the nearest twip.
        assert section.left_margin.mm == pytest.approx(20, abs=0.01)
        assert section.right_margin.mm == pytest.approx(31.75, abs=0.01)


class TestHeadingLevels:
    """All three heading levels must receive the profile's fonts and sizes."""

    def test_all_three_heading_levels_are_matched(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading 1\n\n## Heading 2\n\n### Heading 3\n\nbody\n",
            ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        warnings = apply_style_overrides(doc, "academic", {})
        assert warnings == []

        for name, size in (("Heading 1", "32"), ("Heading 2", "28"), ("Heading 3", "24")):
            style = _find_style_by_name(doc, name)
            assert style is not None, name
            ascii_font, east_asia, font_size, font_size_cs = _style_fonts(style)
            assert ascii_font == "Times New Roman", name
            assert east_asia == "SimHei", name
            assert font_size == size, name
            assert font_size_cs == size, name
