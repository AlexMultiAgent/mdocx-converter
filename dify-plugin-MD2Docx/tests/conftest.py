"""
pytest configuration — shared fixtures and import guards for the md2docx test suite.
"""
import pytest

# Allow pytest to collect tests that import from md2docx even when dify_plugin
# is not installed (e.g., CI environments that only install requirements-dev.txt).
pytest.register_assert_rewrite("tests")

# The dify_plugin import guard: if dify_plugin is not available, all tests in
# this session are skipped because md2docx.py imports it at module level.
try:
    import dify_plugin  # noqa: F401
except ImportError:
    pytest.skip("dify_plugin not installed — install with: pip install -r requirements-dev.txt", allow_module_level=True)
