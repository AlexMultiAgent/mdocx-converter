"""Packaging contract tests for the Dify plugin archive."""

import subprocess
import sys
import zipfile
from pathlib import Path

import yaml


PLUGIN_ROOT = Path(__file__).resolve().parents[1]


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
