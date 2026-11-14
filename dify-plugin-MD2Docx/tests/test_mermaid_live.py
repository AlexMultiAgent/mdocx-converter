"""Optional live Mermaid Ink integration test."""

import os
import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("RUN_LIVE_MERMAID") != "1",
        reason="set RUN_LIVE_MERMAID=1 to call the public Mermaid Ink service",
    ),
]


def test_public_mermaid_ink_returns_png():
    from _mermaid_render import is_png, render_mermaid_via_api

    png = render_mermaid_via_api("graph TD; A-->B", timeout=30)
    assert is_png(png)
