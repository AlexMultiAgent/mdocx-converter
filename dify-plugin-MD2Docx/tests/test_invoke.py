"""
Unit tests for Md2DocxTool._invoke with mocked dependencies.

Requires dify_plugin to be installed (it's in requirements.txt).
"""
import os
import sys
import io

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


# ── Message collector helper ───────────────────────────────────

class FakeToolInvokeMessage:
    """Simulates a dify_plugin ToolInvokeMessage for test assertions."""
    def __init__(self, msg_type, data):
        self.type = msg_type
        self.data = data


class FakeTool:
    """Simulates dify_plugin Tool base class methods."""
    def create_text_message(self, text: str):
        return FakeToolInvokeMessage("text", text)

    def create_json_message(self, data: dict):
        return FakeToolInvokeMessage("json", data)

    def create_blob_message(self, blob, meta=None, save_as=None):
        return FakeToolInvokeMessage("blob", {"blob": blob, "meta": meta, "save_as": save_as})


# ── Fake Document for style overrides ──────────────────────────


class _FakeParagraphFormat:
    def __init__(self):
        from lxml import etree
        self._element = etree.Element(
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pPr"
        )


class _FakeStyle:
    def __init__(self):
        from lxml import etree
        self._element = etree.Element(
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}style"
        )
        self.paragraph_format = _FakeParagraphFormat()


class _FakeStyles:
    def __getitem__(self, name):
        return _FakeStyle()


class _FakeSection:
    top_margin = None
    bottom_margin = None
    left_margin = None
    right_margin = None


class _FakeDocument:
    def __init__(self):
        self.styles = _FakeStyles()
        self.sections = [_FakeSection()]

    def save(self, stream):
        stream.write(b"fake-saved-docx")


# ── Tests ──────────────────────────────────────────────────────


class TestMd2DocxToolInvoke:
    """Tests for _invoke error paths and edge cases using mocks."""

    @pytest.fixture(autouse=True)
    def mock_externals(self, monkeypatch):
        """Mock all external dependencies."""
        monkeypatch.setattr(
            "md2docx._ensure_pandoc", lambda: None
        )
        monkeypatch.setattr(
            "md2docx.convert_via_pandoc",
            lambda *a, **kw: io.BytesIO(b"fake-docx-content")
        )
        monkeypatch.setattr(
            "md2docx.Document",
            lambda *a, **kw: _FakeDocument()
        )
        monkeypatch.setattr(
            "md2docx.apply_style_overrides",
            lambda doc, profile, params: []
        )
        monkeypatch.setattr(
            "md2docx.preprocess_mermaid",
            lambda markdown_text, enabled=True: (markdown_text, 0, "", [])
        )

    def _make_tool(self):
        """Create a Md2DocxTool with fake runtime/session and base methods injected."""
        from md2docx import Md2DocxTool
        tool = Md2DocxTool.__new__(Md2DocxTool)
        fake = FakeTool()
        tool.create_text_message = fake.create_text_message
        tool.create_json_message = fake.create_json_message
        tool.create_blob_message = fake.create_blob_message
        return tool

    def test_empty_markdown_content(self):
        """Empty markdown should yield error json + text and return."""
        tool = self._make_tool()
        messages = list(tool._invoke({"markdown_content": ""}))

        json_msgs = [m for m in messages if m.type == "json"]
        text_msgs = [m for m in messages if m.type == "text"]

        assert len(json_msgs) == 1
        assert json_msgs[0].data["status"] == "error"
        assert json_msgs[0].data["stage"] == "validation"
        assert len(text_msgs) == 1
        assert "empty" in text_msgs[0].data.lower()

    def test_mermaid_disabled(self):
        """mermaid_enabled=False should skip rendering, no warning."""
        tool = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Hello\n\nWorld.",
            "mermaid_enabled": False,
        }))

        json_msgs = [m for m in messages if m.type == "json"]
        blob_msgs = [m for m in messages if m.type == "blob"]

        assert len(blob_msgs) == 1
        success_jsons = [m for m in json_msgs if m.data.get("status") == "success"]
        warning_jsons = [m for m in json_msgs if "warning" in m.data]
        assert len(success_jsons) == 1
        assert len(warning_jsons) == 0

    def test_style_profile_template(self):
        """template profile should still produce a blob."""
        tool = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Hello\n\nWorld.",
            "style_profile": "template",
        }))

        blob_msgs = [m for m in messages if m.type == "blob"]
        assert len(blob_msgs) == 1

    def test_conversion_error_yields_structured_json(self, monkeypatch):
        """Conversion failure should yield error json with stage info."""
        monkeypatch.setattr(
            "md2docx.convert_via_pandoc",
            lambda *a, **kw: (_ for _ in ()).throw(
                RuntimeError("Pandoc conversion failed: test error")
            )
        )

        tool = self._make_tool()
        messages = list(tool._invoke({"markdown_content": "# Bad doc\n"}))

        json_msgs = [m for m in messages if m.type == "json"]
        text_msgs = [m for m in messages if m.type == "text"]

        assert len(json_msgs) == 1
        error_json = json_msgs[0]
        assert error_json.data["status"] == "error"
        assert "stage" in error_json.data
        assert "message" in error_json.data
        assert len(text_msgs) == 1
        assert "pandoc_conversion" in text_msgs[0].data.lower()

    def test_custom_template_bytes(self, monkeypatch, tmp_path):
        """custom_template as bytes should be processed."""
        # Ensure resolve_template returns a valid path
        dummy_ref = tmp_path / "ref.docx"
        dummy_ref.write_bytes(b"dummy-reference")
        monkeypatch.setattr(
            "md2docx.resolve_template",
            lambda *a, **kw: str(dummy_ref)
        )

        tool = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Hello\n",
            "custom_template": b"fake-template-bytes",
        }))

        blob_msgs = [m for m in messages if m.type == "blob"]
        assert len(blob_msgs) == 1

    def test_mermaid_warning_yielded(self, monkeypatch):
        """When mermaid_errors is non-empty, a warning json should be yielded."""
        monkeypatch.setattr(
            "md2docx.preprocess_mermaid",
            lambda markdown_text, enabled=True: (
                markdown_text, 0, "", ["Diagram 1: Connection timeout"]
            )
        )

        tool = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Doc\n\n```mermaid\ngraph TD\nA-->B\n```\n",
            "mermaid_enabled": True,
        }))

        json_msgs = [m for m in messages if m.type == "json"]
        warning_jsons = [m for m in json_msgs if "warning" in m.data]
        assert len(warning_jsons) == 1
        assert "Connection timeout" in str(warning_jsons[0].data["warning"])

    def test_thesis_profile(self):
        """thesis profile should produce a blob."""
        tool = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# 摘要\n\n本文...",
            "style_profile": "thesis",
        }))

        blob_msgs = [m for m in messages if m.type == "blob"]
        assert len(blob_msgs) == 1

    def test_success_yields_structured_json(self):
        """Successful conversion should yield success json with file info."""
        tool = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Hello\n\nWorld.",
            "title": "TestReport",
        }))

        json_msgs = [m for m in messages if m.type == "json"]
        success_jsons = [m for m in json_msgs if m.data.get("status") == "success"]
        assert len(success_jsons) == 1
        assert success_jsons[0].data["file"] == "TestReport.docx"
        assert "size_kb" in success_jsons[0].data

class TestMd2DocxToolInvokeEdgeCases:
    """Edge-case tests for security and validation paths."""

    @pytest.fixture(autouse=True)
    def mock_externals(self, monkeypatch):
        """Mock all external dependencies for edge cases."""
        monkeypatch.setattr("md2docx._ensure_pandoc", lambda: None)
        monkeypatch.setattr(
            "md2docx.convert_via_pandoc",
            lambda *a, **kw: io.BytesIO(b"fake-docx-content")
        )
        monkeypatch.setattr(
            "md2docx.Document",
            lambda *a, **kw: _FakeDocument()
        )
        monkeypatch.setattr(
            "md2docx.apply_style_overrides",
            lambda doc, profile, params: []
        )
        monkeypatch.setattr(
            "md2docx.preprocess_mermaid",
            lambda markdown_text, enabled=True: (markdown_text, 0, "", [])
        )

    def _make_tool(self):
        """Create a Md2DocxTool with fake runtime/session and base methods injected."""
        from md2docx import Md2DocxTool, MAX_MARKDOWN_BYTES
        tool = Md2DocxTool.__new__(Md2DocxTool)
        fake = FakeTool()
        tool.create_text_message = fake.create_text_message
        tool.create_json_message = fake.create_json_message
        tool.create_blob_message = fake.create_blob_message
        return tool, MAX_MARKDOWN_BYTES

    def test_oversized_markdown_rejected(self):
        """Input larger than MAX_MARKDOWN_BYTES is rejected with structured error."""
        tool, limit = self._make_tool()
        big = 'x' * (limit + 1)
        messages = list(tool._invoke({"markdown_content": big}))

        json_msgs = [m for m in messages if m.type == 'json']
        text_msgs = [m for m in messages if m.type == 'text']
        blob_msgs = [m for m in messages if m.type == 'blob']

        assert len(blob_msgs) == 0, "No DOCX should be produced for oversize input"
        assert len(json_msgs) == 1
        assert json_msgs[0].data['status'] == 'error'
        assert json_msgs[0].data['stage'] == 'validation'
        assert 'exceeds' in json_msgs[0].data['message'].lower()
        assert len(text_msgs) == 1
        assert 'limit' in text_msgs[0].data.lower()

    def test_oversized_markdown_exactly_at_limit_accepted(self):
        """Input at exactly the size limit is accepted (boundary check)."""
        tool, limit = self._make_tool()
        # Build content whose UTF-8 byte length is exactly the limit.
        # The implementation measures len(s.encode("utf-8")).
        # Use ASCII so 1 char == 1 byte.
        big = 'x' * limit
        messages = list(tool._invoke({"markdown_content": big}))
        blob_msgs = [m for m in messages if m.type == 'blob']
        assert len(blob_msgs) == 1

    def test_custom_template_str_rejected_with_warning(self):
        """custom_template=str must be rejected with a warning, not silently corrupted."""
        tool, _ = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Hi\n",
            "custom_template": "not-bytes",
        }))

        blob_msgs = [m for m in messages if m.type == 'blob']
        warning_msgs = [m for m in messages if m.type == 'json' and 'warning' in m.data]
        # Should still produce a docx (using built-in template), and warn.
        assert len(blob_msgs) == 1
        assert len(warning_msgs) == 1
        assert 'string' in str(warning_msgs[0].data['warning']).lower()

    def test_custom_template_unsupported_type_rejected_with_warning(self):
        """custom_template with an unsupported type is rejected with a warning."""
        tool, _ = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Hi\n",
            "custom_template": {"key": "value"},
        }))

        warning_msgs = [m for m in messages if m.type == 'json' and 'warning' in m.data]
        assert len(warning_msgs) == 1
        assert 'unsupported type' in str(warning_msgs[0].data['warning']).lower()

    def test_style_override_warnings_yielded(self, monkeypatch):
        """When apply_style_overrides returns warnings, they are propagated as JSON."""
        monkeypatch.setattr(
            "md2docx.apply_style_overrides",
            lambda doc, profile, params: ["Heading 1 style not found"],
        )
        tool, _ = self._make_tool()
        messages = list(tool._invoke({"markdown_content": "# Hi\n"}))
        warning_msgs = [m for m in messages if m.type == 'json' and 'warning' in m.data]
        assert len(warning_msgs) == 1
        assert 'Heading 1' in str(warning_msgs[0].data['warning'])

    def test_mermaid_and_style_warnings_combined(self, monkeypatch):
        """Mermaid errors and style warnings are merged into a single warning JSON."""
        monkeypatch.setattr(
            "md2docx.preprocess_mermaid",
            lambda md, enabled=True: (md, 0, "", ["Diagram 1: timeout"]),
        )
        monkeypatch.setattr(
            "md2docx.apply_style_overrides",
            lambda doc, profile, params: ["Heading 2 not found"],
        )
        tool, _ = self._make_tool()
        messages = list(tool._invoke({
            "markdown_content": "# Hi\n```mermaid\ngraph TD; A-->B\n```\n",
        }))
        warning_msgs = [m for m in messages if m.type == 'json' and 'warning' in m.data]
        assert len(warning_msgs) == 1
        joined = ' | '.join(warning_msgs[0].data['warning'])
        assert 'Diagram 1' in joined
        assert 'Heading 2' in joined
