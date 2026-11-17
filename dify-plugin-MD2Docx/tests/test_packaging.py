"""Packaging contract tests for the Dify plugin archive."""

import hashlib
import importlib.util
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import yaml


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
_PACKAGE_SPEC = importlib.util.spec_from_file_location(
    "md2docx_package_script", PLUGIN_ROOT / "scripts" / "package.py"
)
assert _PACKAGE_SPEC is not None and _PACKAGE_SPEC.loader is not None
package_script = importlib.util.module_from_spec(_PACKAGE_SPEC)
_PACKAGE_SPEC.loader.exec_module(package_script)


def _make_minimal_plugin(root: Path) -> None:
    for name in package_script.REQUIRED_ENTRIES:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if name == ".difyignore":
            target.write_text(".ruff_cache/\n", encoding="utf-8")
        else:
            target.write_bytes(f"content:{name}".encode())



def test_package_script_builds_a_clean_archive(tmp_path):
    output = tmp_path / "MD2Docx.difypkg"
    result = subprocess.run(
        [sys.executable, "scripts/package.py", "--output", str(output)],
        cwd=PLUGIN_ROOT,
        text=True,
        capture_output=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    assert output.exists()

    with zipfile.ZipFile(output) as archive:
        names = set(archive.namelist())

    assert "manifest.yaml" in names
    assert "main.py" in names
    assert "src/md2docx.py" in names
    assert "_assets/icon.svg" in names
    assert ".difyignore" in names
    assert not any(name.startswith("tests/") for name in names)
    assert not any(name.startswith("scripts/") for name in names)


def test_advanced_numeric_parameters_have_ui_bounds():
    tool = yaml.safe_load(
        (PLUGIN_ROOT / "tools/md_to_docx_advanced.yaml").read_text(encoding="utf-8")
    )
    numeric = {
        parameter["name"]: parameter
        for parameter in tool["parameters"]
        if parameter["type"] == "number"
    }
    assert numeric
    assert all("min" in parameter and "max" in parameter for parameter in numeric.values())


def test_package_ignores_common_tool_caches():
    patterns = package_script.load_ignore_patterns(PLUGIN_ROOT)
    for cache in (".ruff_cache/", ".mypy_cache/", ".venv/", ".pytest_cache/"):
        assert package_script.is_ignored(Path(cache) / "junk", patterns)


def test_repeated_package_builds_are_byte_identical(tmp_path):
    root = tmp_path / "plugin"
    _make_minimal_plugin(root)
    first = tmp_path / "first.difypkg"
    second = tmp_path / "second.difypkg"

    package_script.build_package(root, first)
    marker = root / "manifest.yaml"
    os.utime(marker, (946684800, 946684800))
    package_script.build_package(root, second)

    assert hashlib.sha256(first.read_bytes()).digest() == hashlib.sha256(
        second.read_bytes()
    ).digest()
