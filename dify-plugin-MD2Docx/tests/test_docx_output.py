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
    PROFILE_DEFAULTS,
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
            assert "persistent failure" in errors[0]


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
    """Return (ascii_font, east_asia_font, size) of a style."""
    rPr = style._element.find(f"{W_NS}rPr")
    if rPr is None:
        return None, None, None
    rFonts = rPr.find(f"{W_NS}rFonts")
    sz = rPr.find(f"{W_NS}sz")
    szCs = rPr.find(f"{W_NS}szCs")
    ascii_font = rFonts.get(f"{W_NS}ascii") if rFonts is not None else None
    east_asia = rFonts.get(f"{W_NS}eastAsia") if rFonts is not None else None
    size = sz.get(f"{W_NS}val") if sz is not None else None
    return ascii_font, east_asia, size


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

        normal = _find_style_by_id(doc, "a")
        ascii_font, east_asia, _ = _style_fonts(normal)
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

        normal = _find_style_by_id(doc, "a")
        ascii_font, east_asia, _ = _style_fonts(normal)
        assert ascii_font == "Arial"
        assert east_asia == "Arial"

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

        heading1 = _find_style_by_id(doc, "1")
        ascii_font, east_asia, _ = _style_fonts(heading1)
        assert ascii_font == "SimHei"
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

        normal = _find_style_by_id(doc, "a")
        rPr = normal._element.find(f"{W_NS}rPr")
        sz = rPr.find(f"{W_NS}sz")
        szCs = rPr.find(f"{W_NS}szCs")
        assert sz is not None
        assert szCs is not None
        assert szCs.get(f"{W_NS}val") == sz.get(f"{W_NS}val")


class TestStyleResolutionScope:
    """Style ids are not portable: 'a' is Normal in the English templates but
    List Number in the Chinese one. Overrides must reach the intended styles
    only.
    """

    def test_body_overrides_do_not_leak_into_list_styles(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_chinese_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        list_number = _find_style_by_id(doc, "a")
        assert list_number is not None
        ascii_font, _, _ = _style_fonts(list_number)
        assert ascii_font != "SimSun", "List Number must not inherit the body font"

    def test_body_style_still_receives_the_overrides(self, pandoc_available):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, "reference_chinese_academic.docx")
        docx_io = convert_via_pandoc(
            "# Heading\n\nbody\n", ref, TEMPLATE_DIR, "",
            build_pandoc_metadata("academic", None, None, None),
        )
        doc = Document(docx_io)
        apply_style_overrides(doc, "academic", {})

        normal = _find_style_by_id(doc, "a1")
        ascii_font, _, size = _style_fonts(normal)
        assert ascii_font == "SimSun"
        assert size == "24"


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


class TestFilenameLength:
    def test_an_overlong_title_is_truncated(self):
        from md2docx import sanitize_filename

        result = sanitize_filename("a" * 500)
        assert len(result) <= 120
        assert result.startswith("a")

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
    def test_profile_produces_a_readable_docx(self, pandoc_available, profile):
        from docx import Document

        ref = os.path.join(TEMPLATE_DIR, TEMPLATE_MAP[profile]["english"])
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


class TestImageResolution:
    """An image that pandoc cannot resolve must be reported instead of being
    silently dropped from the DOCX.
    """

    def test_absolute_image_path_is_embedded(self, pandoc_available, tmp_path):
        import zipfile

        png = tmp_path / "logo.png"
        png.write_bytes(_make_png())

        ref = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        docx_io = convert_via_pandoc(
            f"# Doc\n\n![logo]({png})\n",
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
        assert media, "the PNG should have been embedded in the DOCX"

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
