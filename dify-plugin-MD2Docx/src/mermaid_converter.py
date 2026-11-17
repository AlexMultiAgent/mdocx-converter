"""Mermaid Converter — render a Mermaid diagram to a PNG image via Mermaid Ink API.

This is a standalone Dify Tool. It is split from `md2docx.py` because the Dify
SDK's class loader (`load_single_subclass_from_source`) requires exactly one
`Tool` subclass per source file.

The Mermaid HTTP helpers live in `_mermaid_render.py` and are loaded via
`importlib.util.spec_from_file_location` because the SDK's class loader does
not add the source file's directory to `sys.path`, which would break a plain
`from _mermaid_render import ...` (no parent directory registered, no package
name on the sibling module).
"""

import importlib.util
import re
from pathlib import Path
from typing import Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

# Path-based import of the shared Mermaid renderer. Sibling file in the same
# directory as this module — resolved relative to `__file__` so it works no
# matter what the host process's CWD or `sys.path` look like.
_RENDERER_PATH = Path(__file__).resolve().parent / "_mermaid_render.py"
_spec = importlib.util.spec_from_file_location("_mermaid_render", _RENDERER_PATH)
if _spec is None or _spec.loader is None:  # pragma: no cover - defensive
    raise ImportError(f"Failed to load shared Mermaid renderer from {_RENDERER_PATH}")
_mermaid_render = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mermaid_render)

render_mermaid_via_api = _mermaid_render.render_mermaid_via_api
render_mermaid_with_retry = _mermaid_render.render_mermaid_with_retry
validate_api_url = _mermaid_render.validate_api_url
describe_render_failure = _mermaid_render.describe_render_failure

# Upper bound for the diagram source. The text is shipped verbatim to a
# third-party rendering service, so an oversized payload is rejected outright.
MAX_MERMAID_CODE_BYTES = 256 * 1024

_FENCE_RE = re.compile(r"^```[a-zA-Z0-9_+-]*\s*\n?", re.MULTILINE)


class MermaidConverterTool(Tool):
    """Dify Tool: render Mermaid diagram code to a PNG image."""

    def _invoke(self, parameters: dict) -> Generator[ToolInvokeMessage, None, None]:
        raw_code = parameters.get("mermaid_code")
        if raw_code is None:
            raw_code = ""
        if not isinstance(raw_code, str):
            yield self.create_text_message("Error: mermaid_code must be a string")
            return

        code = raw_code.strip()
        if not code:
            yield self.create_text_message("Error: mermaid_code is required")
            return

        if len(code.encode("utf-8")) > MAX_MERMAID_CODE_BYTES:
            limit_kb = MAX_MERMAID_CODE_BYTES // 1024
            yield self.create_text_message(
                f"Error: mermaid_code exceeds the {limit_kb}KB limit."
            )
            return

        # Strip code fences if present
        if code.startswith("```"):
            code = _FENCE_RE.sub("", code)
            code = re.sub(r"```\s*$", "", code).strip()

        try:
            api_url = validate_api_url(parameters.get("mermaid_api_url"))
        except ValueError as e:
            yield self.create_text_message(f"Error: {e}")
            return

        try:
            png_bytes = render_mermaid_with_retry(
                code, api_url=api_url, renderer=render_mermaid_via_api
            )
        except Exception as e:
            yield self.create_text_message(
                f"Mermaid rendering failed: {describe_render_failure(e)}"
            )
            return

        yield self.create_blob_message(
            blob=png_bytes,
            meta={"mime_type": "image/png", "filename": "diagram.png"},
        )
