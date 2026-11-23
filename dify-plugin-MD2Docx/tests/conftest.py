"""
pytest configuration — shared fixtures and import guards for the md2docx test suite.
"""
import importlib

import pytest

# The dify_plugin import guard: if dify_plugin is not available, all tests in
# this session are skipped because md2docx.py imports it at module level.
#
# The module is loaded through importlib rather than with an `import` statement,
# because the import is the guard and nothing here ever uses the binding. A
# plain `import dify_plugin` would leave an unused name behind, which the
# linter reports as an error even though the import is the whole point.
try:
    importlib.import_module("dify_plugin")
except ImportError:
    pytest.skip(
        "dify_plugin not installed — install with: pip install -r requirements-dev.txt",
        allow_module_level=True,
    )