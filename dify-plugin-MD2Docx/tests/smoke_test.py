"""
Smoke test for md2docx conversion pipeline.
Run outside Dify to verify core logic works.
"""
import os
import sys
import shutil
import tempfile

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
processed, count, temp_dir, errors = preprocess_mermaid(md_with_mermaid, enabled=True)
if count == 1:
    assert "Mermaid Diagram" in processed
    print("OK: mermaid preprocessing (1 diagram — API available)")
else:
    assert "```mermaid" in processed
    print(f"OK: mermaid preprocessing (API unavailable — block preserved, errors: {errors})")
# Clean up temp dir
if temp_dir and os.path.isdir(temp_dir):
    shutil.rmtree(temp_dir, ignore_errors=True)

processed_off, count_off, _, _ = preprocess_mermaid(md_with_mermaid, enabled=False)
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

# Test sanitize_filename
assert sanitize_filename("Report: Q1/2025") == "Report_ Q1_2025"
assert sanitize_filename("") == "Document"
assert sanitize_filename("a/b:c") == "a_b_c"
print("OK: filename sanitization")

# Test _coerce_bool
assert _coerce_bool(True) is True
assert _coerce_bool(False) is False
assert _coerce_bool("true") is True
assert _coerce_bool("false") is False
assert _coerce_bool("0") is False
assert _coerce_bool("no") is False
assert _coerce_bool("NO") is False
assert _coerce_bool("") is False
assert _coerce_bool("off") is False
assert _coerce_bool(1) is True
print("OK: _coerce_bool")

# Test _map_pandoc_error
assert "Close the target DOCX" in _map_pandoc_error("Permission denied")
assert "image" in _map_pandoc_error("Cannot decode image: logo.png")
assert "syntax" in _map_pandoc_error("Unknown extension: .xyz")
assert "reference template" in _map_pandoc_error("not a valid docx file")
print("OK: pandoc error mapping")

print("\nAll smoke tests passed!")
