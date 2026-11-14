#!/usr/bin/env python3
"""Build a deterministic Dify plugin package from this directory."""

import argparse
import fnmatch
import os
import zipfile
from pathlib import Path


REQUIRED_ENTRIES = {
    ".difyignore",
    "_assets/icon.svg",
    "icon.svg",
    "main.py",
    "manifest.yaml",
    "provider/md2docx.py",
    "provider/md2docx.yaml",
    "requirements.txt",
    "src/_mermaid_render.py",
    "src/md2docx.py",
    "src/mermaid_converter.py",
    "tools/md_to_docx.yaml",
    "tools/md_to_docx_advanced.yaml",
    "tools/mermaid_converter.yaml",
}


def load_ignore_patterns(root: Path) -> list[str]:
    ignore_file = root / ".difyignore"
    if not ignore_file.is_file():
        raise FileNotFoundError(f"Missing {ignore_file}")
    return [
        line.strip()
        for line in ignore_file.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def is_ignored(relative_path: Path, patterns: list[str]) -> bool:
    path = relative_path.as_posix()
    for pattern in patterns:
        if pattern.endswith("/"):
            prefix = pattern.rstrip("/")
            if path == prefix or path.startswith(prefix + "/"):
                return True
        elif fnmatch.fnmatchcase(path, pattern):
            return True
        elif "/" not in pattern and fnmatch.fnmatchcase(relative_path.name, pattern):
            return True
    return False


def collect_files(root: Path, output_path: Path) -> list[Path]:
    patterns = load_ignore_patterns(root)
    output_path = output_path.resolve()
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        rel_dir = current.relative_to(root)
        dirnames[:] = sorted(
            name
            for name in dirnames
            if name not in {".git", "__pycache__"}
            and not is_ignored(rel_dir / name, patterns)
        )
        for name in filenames:
            relative_path = rel_dir / name
            candidate = current / name
            if is_ignored(relative_path, patterns):
                continue
            if candidate.resolve() == output_path:
                continue
            files.append(relative_path)
    return sorted(files, key=lambda path: path.as_posix())


def build_package(root: Path, output_path: Path) -> tuple[int, int]:
    root = root.resolve()
    output_path = output_path.resolve()
    files = collect_files(root, output_path)
    names = {path.as_posix() for path in files}
    missing = sorted(REQUIRED_ENTRIES - names)
    if missing:
        raise RuntimeError(f"Package is missing required entries: {missing}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative_path in files:
            archive.write(root / relative_path, relative_path.as_posix())

    with zipfile.ZipFile(output_path) as archive:
        uncompressed_bytes = sum(item.file_size for item in archive.infolist())
    return output_path.stat().st_size, uncompressed_bytes


def main() -> int:
    plugin_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=plugin_root,
        help="Plugin source directory (defaults to the parent of scripts/)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=plugin_root / "MD2Docx.difypkg",
        help="Output package path",
    )
    args = parser.parse_args()

    compressed, uncompressed = build_package(args.root, args.output)
    print(f"Built {args.output.resolve()}")
    print(f"Compressed: {compressed:,} bytes")
    print(f"Uncompressed: {uncompressed:,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
