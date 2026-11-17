"""
Tests for the standalone Mermaid-to-PNG tool.

The tool talks to the public Mermaid Ink API, so the network is mocked here.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class FakeMessage:
    def __init__(self, msg_type, data):
        self.type = msg_type
        self.data = data


class FakeTool:
    def create_text_message(self, text: str):
        return FakeMessage("text", text)

    def create_json_message(self, data: dict):
        return FakeMessage("json", data)

    def create_blob_message(self, blob, meta=None, save_as=None):
        return FakeMessage("blob", {"blob": blob, "meta": meta})


def _make_tool():
    from mermaid_converter import MermaidConverterTool
    tool = MermaidConverterTool.__new__(MermaidConverterTool)
    fake = FakeTool()
    tool.create_text_message = fake.create_text_message
    tool.create_json_message = fake.create_json_message
    tool.create_blob_message = fake.create_blob_message
    return tool


class TestMermaidConverter:
    def test_renders_diagram_to_png(self, monkeypatch):
        from mermaid_converter import MermaidConverterTool  # noqa: F401

        monkeypatch.setattr(
            "mermaid_converter.render_mermaid_via_api",
            lambda diagram, api_url=None, timeout=None: PNG_SIGNATURE + b"\x00" * 16,
        )
        tool = _make_tool()
        messages = list(tool._invoke({"mermaid_code": "graph TD; A-->B"}))

        blob_msgs = [m for m in messages if m.type == "blob"]
        assert len(blob_msgs) == 1
        assert blob_msgs[0].data["blob"].startswith(PNG_SIGNATURE)
        assert blob_msgs[0].data["meta"]["filename"] == "diagram.png"

    def test_rejects_empty_code(self):
        tool = _make_tool()
        messages = list(tool._invoke({"mermaid_code": "   "}))

        assert [m for m in messages if m.type == "blob"] == []
        text = " ".join(m.data for m in messages if m.type == "text")
        assert "required" in text.lower()

    def test_non_string_code_is_rejected_cleanly(self):
        tool = _make_tool()
        messages = list(tool._invoke({"mermaid_code": []}))

        assert [m for m in messages if m.type == "blob"] == []
        text = " ".join(m.data for m in messages if m.type == "text")
        assert "string" in text.lower()

    def test_rejects_oversized_code(self):
        """A huge diagram would be shipped to a third-party API verbatim."""
        from mermaid_converter import MAX_MERMAID_CODE_BYTES

        tool = _make_tool()
        messages = list(tool._invoke({"mermaid_code": "x" * (MAX_MERMAID_CODE_BYTES + 1)}))

        assert [m for m in messages if m.type == "blob"] == []
        text = " ".join(m.data for m in messages if m.type == "text")
        assert "limit" in text.lower() or "too large" in text.lower()

    def test_rejects_non_png_response(self, monkeypatch):
        """An HTML error page must not be handed back as if it were an image."""
        monkeypatch.setattr(
            "mermaid_converter.render_mermaid_via_api",
            lambda diagram, api_url=None, timeout=None: b"<html>502 Bad Gateway</html>",
        )
        tool = _make_tool()
        messages = list(tool._invoke({"mermaid_code": "graph TD; A-->B"}))

        assert [m for m in messages if m.type == "blob"] == []
        text = " ".join(m.data for m in messages if m.type == "text")
        assert "png" in text.lower()

    def test_retries_a_transient_failure(self, monkeypatch):
        calls = {"n": 0}

        def flaky(diagram, api_url=None, timeout=None):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("connection reset")
            return PNG_SIGNATURE + b"\x00" * 16

        monkeypatch.setattr("mermaid_converter.render_mermaid_via_api", flaky)
        monkeypatch.setattr("time.sleep", lambda s: None)

        tool = _make_tool()
        messages = list(tool._invoke({"mermaid_code": "graph TD; A-->B"}))

        assert len([m for m in messages if m.type == "blob"]) == 1
        assert calls["n"] == 2
