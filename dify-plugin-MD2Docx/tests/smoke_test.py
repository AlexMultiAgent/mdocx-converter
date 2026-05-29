"""
Smoke test for md2docx conversion pipeline.
Run outside Dify to verify core logic works.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from md2docx import (
    detect_language,
    resolve_template,
    preprocess_mermaid,
    build_pandoc_metadata,
    _ensure_pandoc,
)

# Test language detection
assert detect_language("Hello world") == "english"
assert detect_language("你好世界" * 10) == "chinese"
print("OK: language detection")

# Test template resolution
plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = resolve_template("academic", "chinese", None, plugin_root)
assert os.path.exists(path), f"Template not found: {path}"
print(f"OK: template resolution -> {os.path.basename(path)}")

# Test Mermaid preprocessing
md_with_mermaid = """# Test Doc

```mermaid
graph TD
    A --> B
```

Some text after.
"""
processed, count = preprocess_mermaid(md_with_mermaid, enabled=True)
# Mermaid Ink API may be unavailable; either outcome is valid
if count == 1:
    assert "Mermaid Diagram" in processed
    print("OK: mermaid preprocessing (1 diagram — API available)")
else:
    # API unavailable: block preserved as code, count stays 0
    assert "```mermaid" in processed
    print("OK: mermaid preprocessing (API unavailable — block preserved)")

processed_off, count_off = preprocess_mermaid(md_with_mermaid, enabled=False)
assert count_off == 0
assert "```mermaid" in processed_off
print("OK: mermaid disabled preserves code block")

# Test pandoc metadata
meta = build_pandoc_metadata("academic", None, None, None)
assert meta["mainfont"] == "Times New Roman"
print(f"OK: pandoc metadata -> {meta}")

# Test pandoc available
_ensure_pandoc()
print("OK: pandoc available")

print("\nAll smoke tests passed!")
