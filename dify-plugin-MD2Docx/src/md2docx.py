"""
md2docx — Convert Markdown to DOCX with templates, Mermaid, and style presets.

Ported from mdocx-converter VS Code extension.
"""

import importlib.util
import os
import re
import io
import base64
import time
import shutil
import tempfile
import zipfile
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from threading import Lock
from typing import Optional, Any, Generator

# ── Dify SDK (must import first — triggers gevent monkey-patch) ──
from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

# ── Third-party imports (safe now — gevent has patched stdlib) ──
import requests
import pypandoc
from docx import Document
from docx.shared import Cm
from docx.oxml.ns import qn
from docx.styles.style import ParagraphStyle
from lxml import etree

# Load the shared Mermaid renderer from its sibling file. The Dify SDK loads
# this module via `importlib.util.spec_from_file_location`, which sets
# `__file__` but does NOT add the parent directory to `sys.path`, so a plain
# `from _mermaid_render import ...` would fail at plugin launch.
_RENDERER_PATH = Path(__file__).resolve().parent / "_mermaid_render.py"
_spec = importlib.util.spec_from_file_location("_mermaid_render", _RENDERER_PATH)
if _spec is None or _spec.loader is None:  # pragma: no cover - defensive
    raise ImportError(f"Failed to load shared Mermaid renderer from {_RENDERER_PATH}")
_mermaid_render = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mermaid_render)

render_mermaid_via_api = _mermaid_render.render_mermaid_via_api
render_mermaid_with_retry = _mermaid_render.render_mermaid_with_retry
validate_api_url = _mermaid_render.validate_api_url
MERMAID_INK_URL = _mermaid_render.MERMAID_INK_URL

# ── Tunables ────────────────────────────────────────────────

# Maximum size of markdown_content (UTF-8 bytes). Larger inputs are rejected
# with a structured error to prevent OOM in the Dify plugin sandbox.
MAX_MARKDOWN_BYTES = 5 * 1024 * 1024  # 5 MB

# Total wall-clock budget for Mermaid rendering across all diagrams. Diagrams
# still running after this are cancelled and reported as timed-out.
MERMAID_TOTAL_BUDGET_SECONDS = 75

# Bound the amount of generated media that can be embedded in one request.
MAX_MERMAID_DIAGRAMS = 50
MAX_MERMAID_TOTAL_BYTES = 32 * 1024 * 1024

# Number of diagrams rendered at the same time.
MERMAID_MAX_WORKERS = 4

# Per-attempt timeout and retry count live in `_mermaid_render.py`, which both
# tools share.

# ── Regex ───────────────────────────────────────────────────

# A Mermaid block: a fenced code block whose info string is exactly
# "mermaid". The fence may be backticks or tildes and may be indented by up
# to three spaces (four spaces would make it an indented code block). The
# info string must match exactly, otherwise ```mermaidjs would be shipped to
# the rendering service.
MERMAID_BLOCK_RE = re.compile(
    r"(?ms)^[ \t]{0,3}(?P<fence>```+|~~~+)[ \t]*mermaid[ \t]*\r?\n"
    r"(?P<body>.*?)"
    r"^[ \t]{0,3}(?P=fence)[ \t]*\r?$"
)
# CJK ideograph blocks, pinned with explicit escapes: written as literal
# characters the lower bound silently became U+8C48 instead of U+F900, which
# swallowed Hangul and Yi syllables and made Korean documents pick the
# Chinese template here while the VS Code extension picked the English one.
# Keep these as escapes - U+F900 and U+8C48 are indistinguishable by eye.
CJK_CHAR_RE = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
LATIN_CHAR_RE = re.compile(r"[A-Za-z]")

# ── Profile defaults (ported from getProfileDocxDefaults) ───

PROFILE_DEFAULTS: dict[str, dict[str, Any]] = {
    "academic": {
        "body_font": "Times New Roman",
        "body_cjk_font": "SimSun",
        "body_size_pt": 12,
        "heading1_font": "Times New Roman",
        "heading1_cjk_font": "SimHei",
        "heading1_size_pt": 16,
        "heading2_font": "Times New Roman",
        "heading2_cjk_font": "SimHei",
        "heading2_size_pt": 14,
        "heading3_font": "Times New Roman",
        "heading3_cjk_font": "SimHei",
        "heading3_size_pt": 12,
        "line_spacing": 1.5,
        "margin_top_mm": 25.4,
        "margin_bottom_mm": 25.4,
        "margin_left_mm": 25.4,
        "margin_right_mm": 25.4,
    },
    "business": {
        "body_font": "Arial",
        "body_cjk_font": "Microsoft YaHei",
        "body_size_pt": 11,
        "heading1_font": "Arial",
        "heading1_cjk_font": "Microsoft YaHei",
        "heading1_size_pt": 18,
        "heading2_font": "Arial",
        "heading2_cjk_font": "Microsoft YaHei",
        "heading2_size_pt": 14,
        "heading3_font": "Arial",
        "heading3_cjk_font": "Microsoft YaHei",
        "heading3_size_pt": 12,
        "line_spacing": 1.5,
        "margin_top_mm": 25.4,
        "margin_bottom_mm": 25.4,
        "margin_left_mm": 25.4,
        "margin_right_mm": 25.4,
    },
    "technical": {
        "body_font": "Arial",
        "body_cjk_font": "Microsoft YaHei",
        "body_size_pt": 11,
        "heading1_font": "Arial",
        "heading1_cjk_font": "Microsoft YaHei",
        "heading1_size_pt": 16,
        "heading2_font": "Arial",
        "heading2_cjk_font": "Microsoft YaHei",
        "heading2_size_pt": 14,
        "heading3_font": "Arial",
        "heading3_cjk_font": "Microsoft YaHei",
        "heading3_size_pt": 12,
        "line_spacing": 1.35,
        "margin_top_mm": 19,
        "margin_bottom_mm": 19,
        "margin_left_mm": 19,
        "margin_right_mm": 19,
    },
    "official": {
        "body_font": "Times New Roman",
        "body_cjk_font": "FangSong",
        "body_size_pt": 16,
        "heading1_font": "Times New Roman",
        "heading1_cjk_font": "SimHei",
        "heading1_size_pt": 16,
        "heading2_font": "Times New Roman",
        "heading2_cjk_font": "KaiTi",
        "heading2_size_pt": 16,
        "heading3_font": "Times New Roman",
        "heading3_cjk_font": "FangSong",
        "heading3_size_pt": 16,
        "line_spacing": 1.75,
        "margin_top_mm": 37,
        "margin_bottom_mm": 35,
        "margin_left_mm": 28,
        "margin_right_mm": 26,
    },
    "thesis": {
        "body_font": "Times New Roman",
        "body_cjk_font": "SimSun",
        "body_size_pt": 12,
        "heading1_font": "Times New Roman",
        "heading1_cjk_font": "SimHei",
        "heading1_size_pt": 22,
        "heading2_font": "Times New Roman",
        "heading2_cjk_font": "SimHei",
        "heading2_size_pt": 16,
        "heading3_font": "Times New Roman",
        "heading3_cjk_font": "SimHei",
        "heading3_size_pt": 14,
        "line_spacing": 1.5,
        "margin_top_mm": 30,
        "margin_bottom_mm": 30,
        "margin_left_mm": 30,
        "margin_right_mm": 30,
    },
    "template": {},
}

# ── Pandoc metadata derived from the profile defaults ────────

def _build_profile_metadata() -> dict[str, dict[str, str]]:
    metadata_by_profile: dict[str, dict[str, str]] = {}
    for profile, defaults in PROFILE_DEFAULTS.items():
        if not defaults:
            metadata_by_profile[profile] = {}
            continue
        metadata = {
            "mainfont": defaults["body_font"],
            "CJKmainfont": defaults["body_cjk_font"],
            "fontsize": f"{defaults['body_size_pt']}pt",
            "linestretch": str(defaults["line_spacing"]),
        }
        if profile == "technical":
            metadata["monofont"] = "Consolas"
        metadata_by_profile[profile] = metadata
    return metadata_by_profile


PROFILE_METADATA = _build_profile_metadata()

# ── Bundled template mapping ─────────────────────────────────

TEMPLATE_MAP: dict[str, dict[str, str]] = {
    "academic": {
        "english": "reference_english_academic.docx",
        "chinese": "reference_chinese_academic.docx",
    },
    "template": {
        "english": "reference_english_academic.docx",
        "chinese": "reference_chinese_academic.docx",
    },
    "technical": {
        "english": "reference_english_technical.docx",
        "chinese": "reference_chinese_technical.docx",
    },
    "business": {
        "english": "reference_english_business.docx",
        "chinese": "reference_chinese_business.docx",
    },
    "official": {
        "english": "reference_english_official.docx",
        "chinese": "reference_chinese_official.docx",
    },
    "thesis": {
        "english": "reference_english_academic.docx",
        "chinese": "reference_chinese_academic.docx",
    },
}

VALID_PROFILES = {"template", "academic", "business", "technical", "official", "thesis"}

# Style display names as they appear in `w:name`. Style ids are deliberately
# not used for body and heading styles: they are not portable between
# templates ('a' is Normal in the English templates but List Number in the
# Chinese one, 'a1' is Normal Table in English), so matching by id would put
# the body font on list and table styles.
NORMAL_STYLE_NAMES = ("Normal", "Text", "BodyText", "Body Text",
                       "FirstParagraph", "First Paragraph", "Compact")
HEADING_ALIASES = {
    "Heading 1": ("Heading 1",),
    "Heading 2": ("Heading 2",),
    "Heading 3": ("Heading 3",),
}
# Code styles have unambiguous custom ids, so they may be matched by id too.
CODE_STYLE_NAMES = ("Source Code", "Verbatim Char", "Code")
CODE_STYLE_IDS = ("SourceCode", "VerbatimChar", "Code")


# ── Language detection ───────────────────────────────────────

def detect_language(markdown_text: str) -> str:
    """Return 'chinese' or 'english' based on CJK character count."""
    sample = markdown_text[:20000]
    cjk_count = len(CJK_CHAR_RE.findall(sample))
    latin_count = len(LATIN_CHAR_RE.findall(sample))

    if cjk_count >= 40 or cjk_count > latin_count * 0.15:
        return "chinese"
    return "english"


def resolve_language(setting: str, markdown_text: str) -> str:
    """Resolve the reference language from the user setting and markdown content."""
    if setting in ("english", "chinese"):
        return setting
    return detect_language(markdown_text)


# ── Template resolution ──────────────────────────────────────

def resolve_template(
    style_profile: str,
    reference_language: str,
    custom_template_path: Optional[str],
    plugin_root: str,
) -> str:
    """Return path to the reference.docx to use.

    Priority: custom_template > built-in template.
    """
    if custom_template_path and os.path.exists(custom_template_path):
        return custom_template_path

    profile = style_profile if style_profile in VALID_PROFILES else "template"
    lang = reference_language if reference_language in ("english", "chinese") else "english"

    filename = TEMPLATE_MAP[profile][lang]
    template_path = os.path.join(plugin_root, "multi-templates", filename)

    if os.path.exists(template_path):
        return template_path

    raise FileNotFoundError(
        f"Built-in template {filename} not found in multi-templates/. "
        f"Profile={profile}, language={lang}"
    )


# ── Settings normalization ───────────────────────────────────

def normalize_profile(value: Optional[str]) -> str:
    """Normalize style profile to a valid value."""
    if value in VALID_PROFILES:
        return value
    return "template"


MIN_FONT_SIZE_PT = 1.0
MAX_FONT_SIZE_PT = 96.0
MIN_LINE_SPACING = 0.5
MAX_LINE_SPACING = 4.0
MIN_MARGIN_MM = 1.0
MAX_MARGIN_MM = 50.0


def _parse_number_in_range(
    value, minimum: float, maximum: float
) -> Optional[float]:
    """Parse a finite number inside an inclusive range."""
    if value is None:
        return None
    # Guard against bool (subclass of int): float(True) == 1.0
    if isinstance(value, bool):
        return None
    try:
        v = float(value)
        if not (minimum <= v <= maximum):
            return None
        return v
    except (TypeError, ValueError):
        return None


def parse_pt(value) -> Optional[float]:
    """Parse a font-size value in points, returning None outside safe bounds."""
    return _parse_number_in_range(value, MIN_FONT_SIZE_PT, MAX_FONT_SIZE_PT)


def parse_spacing(value) -> Optional[float]:
    """Parse a line-spacing multiplier, returning None outside safe bounds."""
    return _parse_number_in_range(value, MIN_LINE_SPACING, MAX_LINE_SPACING)


def parse_mm(value) -> Optional[float]:
    """Parse a margin in millimeters, returning None outside safe bounds."""
    return _parse_number_in_range(value, MIN_MARGIN_MM, MAX_MARGIN_MM)


# ── Title sanitization ───────────────────────────────────────

_FILENAME_BAD_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

# Longest title we keep. The name becomes the file name of the produced
# document and must leave room for the directory it is stored in.
MAX_TITLE_LENGTH = 120


def sanitize_filename(name: str) -> str:
    """Replace characters illegal in filenames with underscores."""
    cleaned = _FILENAME_BAD_CHARS_RE.sub("_", name).strip() or "Document"
    return cleaned[:MAX_TITLE_LENGTH].strip() or "Document"


# ── Mermaid preprocessing ────────────────────────────────────

# `render_mermaid_via_api` and `MERMAID_INK_URL` are re-exported at the top of
# this module from the shared `src/_mermaid_render.py` file. See the loader
# comment above for why a path-based import is needed.


class _MermaidRenderState:
    """Thread-safe accounting for the total rendered image size."""

    def __init__(self, max_total_bytes: int):
        self.max_total_bytes = max_total_bytes
        self.total_bytes = 0
        self._lock = Lock()

    def reserve(self, size: int) -> bool:
        with self._lock:
            if self.total_bytes + size > self.max_total_bytes:
                return False
            self.total_bytes += size
            return True

    def release(self, size: int) -> None:
        with self._lock:
            self.total_bytes = max(0, self.total_bytes - size)


def _render_one_with_retry(index: int, diagram: str, temp_dir: str,
                            errors: list[str],
                            api_url: str | None = None,
                            deadline: float | None = None,
                            render_state: _MermaidRenderState | None = None) -> tuple[int, str | None, str | None]:
    """Render one Mermaid diagram, retrying transient failures.

    `deadline` is the `time.monotonic()` point after which no attempt is
    started any more. Returns (index, png_path, error_message); the error is
    also appended to `errors` so the caller keeps a complete record.
    """
    try:
        png_bytes = render_mermaid_with_retry(
            diagram,
            api_url=api_url,
            deadline=deadline,
            renderer=render_mermaid_via_api,
        )
    except Exception as e:  # requests.RequestException, OSError, budget, ...
        message = f"Diagram {index}: {e}"
        errors.append(message)
        return index, None, message

    if render_state is not None and not render_state.reserve(len(png_bytes)):
        message = (
            f"Diagram {index}: total rendered image size exceeds the "
            f"{render_state.max_total_bytes // (1024 * 1024)}MB limit."
        )
        errors.append(message)
        return index, None, message

    png_path = os.path.join(temp_dir, f"diagram-{index}.png")
    try:
        with open(png_path, "wb") as f:
            f.write(png_bytes)
    except OSError as e:
        if render_state is not None:
            render_state.release(len(png_bytes))
        message = f"Diagram {index}: {e}"
        errors.append(message)
        return index, None, message
    return index, png_path, None


def preprocess_mermaid(markdown_text: str, enabled: bool = True,
                       api_url: str | None = None) -> tuple[str, int, str, list[str]]:
    """Extract ```mermaid blocks, render to PNGs via API, replace with image refs.

    Returns (processed_markdown, mermaid_count, temp_dir, errors).
    Caller must clean up temp_dir via shutil.rmtree after pandoc conversion.

    Diagrams are rendered in parallel (MERMAID_MAX_WORKERS at a time) and the
    whole step is bounded by MERMAID_TOTAL_BUDGET_SECONDS: once the budget is
    exhausted no further attempt is started and the pending diagrams are
    reported as failed. A diagram that cannot be rendered is kept as its
    original code block so the conversion still succeeds.
    """
    if not enabled:
        return markdown_text, 0, "", []

    matches = list(MERMAID_BLOCK_RE.finditer(markdown_text))
    if not matches:
        return markdown_text, 0, "", []

    temp_dir = tempfile.mkdtemp(prefix="mermaid-")
    errors: list[str] = []
    deadline = time.monotonic() + MERMAID_TOTAL_BUDGET_SECONDS

    # Build segments interleaving non-mermaid text with mermaid-block markers.
    # The diagram index in the 4th slot is 0 for non-mermaid segments.
    segments: list[tuple[int, int, bool, int]] = []
    last_end = 0
    for i, match in enumerate(matches, 1):
        if match.start() > last_end:
            segments.append((last_end, match.start(), False, 0))
        segments.append((match.start(), match.end(), True, i))
        last_end = match.end()
    if last_end < len(markdown_text):
        segments.append((last_end, len(markdown_text), False, 0))

    # Render the diagrams concurrently. Every worker writes to its own file,
    # while the shared state enforces the total image-size limit.
    results: dict[int, str | None] = {}
    render_limit = max(0, MAX_MERMAID_DIAGRAMS)
    render_matches = matches[:render_limit]
    for skipped_index in range(render_limit + 1, len(matches) + 1):
        errors.append(
            f"Diagram {skipped_index}: skipped because the document exceeds "
            f"the {render_limit}-diagram limit."
        )
    render_state = _MermaidRenderState(MAX_MERMAID_TOTAL_BYTES)
    workers = max(1, min(MERMAID_MAX_WORKERS, len(render_matches)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                _render_one_with_retry,
                idx,
                match.group("body").strip(),
                temp_dir,
                [],
                api_url,
                deadline,
                render_state,
            ): idx
            for idx, match in enumerate(render_matches, 1)
        }
        for future in as_completed(futures):
            idx, png_path, message = future.result()
            results[idx] = png_path
            if message:
                errors.append(message)

    # Keep the warning order aligned with the order of the diagrams.
    errors.sort(key=lambda message: int(message.split(":", 1)[0].split()[-1]))

    # Assemble output preserving original order
    parts: list[str] = []
    count = 0
    for start, end, is_mermaid, idx in segments:
        if is_mermaid:
            original_text = markdown_text[start:end]
            png_path = results.get(idx)
            if png_path is not None:
                with open(png_path, "rb") as f:
                    encoded = base64.b64encode(f.read()).decode("ascii")
                parts.append(
                    f"![Mermaid Diagram {idx}]"
                    f"(data:image/png;base64,{encoded})\n\n"
                )
                count += 1
            else:
                parts.append(original_text + "\n\n")
        else:
            parts.append(markdown_text[start:end])

    return "".join(parts), count, temp_dir, errors


# ── Pandoc conversion ────────────────────────────────────────

def _ensure_pandoc() -> None:
    """Check for pandoc. With pypandoc-binary the binary is pre-installed."""
    pypandoc.get_pandoc_version()


# Note: pandoc warmup is intentionally skipped at import time.
# In a gevent-patched environment (LOAD_FROM_DIFY_PLUGIN=1), spawning a
# subprocess before Plugin.run() starts the event loop can deadlock on
# gevent-intercepted I/O. The first real conversion pays the cold-start
# cost (~0.1s) instead.


def build_pandoc_metadata(
    style_profile: str,
    body_font: Optional[str],
    body_size_pt: Optional[float],
    line_spacing: Optional[float],
) -> dict[str, str]:
    """Build the pandoc --metadata dict, layering profile defaults + user overrides."""
    metadata = dict(PROFILE_METADATA.get(style_profile, {}))

    if body_font and body_font.strip():
        font = body_font.strip()
        # The caller only passes a user-supplied font here, and an explicit
        # font name fills both slots.
        metadata["mainfont"] = font
        metadata["CJKmainfont"] = font
    if body_size_pt:
        metadata["fontsize"] = f"{body_size_pt}pt"
    if line_spacing:
        metadata["linestretch"] = str(line_spacing)

    return {k: v for k, v in metadata.items() if v}


def _map_pandoc_error(message: str) -> str:
    """Map raw pandoc errors to user-friendly guidance."""
    msg_lower = message.lower()
    if any(kw in msg_lower for kw in ("permission denied", "access is denied", "eperm", "eacces")):
        return "Pandoc could not write the output file. Close the target DOCX in Word and try again."
    # Image-related errors: use specific phrases (not bare "image") to avoid
    # false positives on other pandoc messages that mention "image format" etc.
    if any(kw in msg_lower for kw in (
        "cannot decode image",
        "could not fetch resource",
        "could not find image",
        "image not found",
    )):
        return "Pandoc could not resolve one or more images. Check that all image paths in the Markdown are valid and accessible."
    if any(kw in msg_lower for kw in ("unknown reader", "unknown extension", "mermaid")):
        return "Pandoc encountered syntax it could not handle. Check for unsupported Markdown constructs or malformed Mermaid blocks."
    if any(kw in msg_lower for kw in ("not a valid docx", "reference docx", "could not read")):
        return "Pandoc could not read the reference template. The uploaded .docx may be corrupted or not in the expected format."
    return f"Pandoc conversion failed: {message}"


class _PandocWarningCollector(logging.Handler):
    """Collects pandoc's warnings.

    pypandoc forwards pandoc's stderr to the ``pypandoc`` logger; without a
    handler those messages vanish, so an image pandoc could not resolve would
    be dropped from the DOCX without the caller ever learning about it.

    The daemon runs tool calls concurrently, so the sink is looked up per
    record rather than held by the handler: a conversion only ever receives
    the warnings of its own pandoc run.
    """

    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno < logging.WARNING:
            return
        sink = _pandoc_warning_sink.get()
        if sink is None:
            return
        message = record.getMessage().strip()
        if not message:
            return
        if "Could not fetch resource" in message:
            message += (
                " — Pandoc runs in a sandbox and does not read external or local "
                "image files; use a data: URI to embed an image."
            )
        sink.append(message)


# The sink of the conversion currently running in this thread / greenlet.
_pandoc_warning_sink: ContextVar[Optional[list[str]]] = ContextVar(
    "pandoc_warning_sink", default=None
)


def _install_pandoc_warning_collector() -> None:
    """Attach the collector to the pypandoc logger, once per process.

    The handler stays installed for the lifetime of the plugin; the per-call
    sink lives in a ContextVar, so concurrent conversions cannot pick up each
    other's warnings.
    """
    logger = logging.getLogger("pypandoc")
    if not any(isinstance(h, _PandocWarningCollector) for h in logger.handlers):
        logger.addHandler(_PandocWarningCollector())
    # Only ever lower the threshold, so pandoc's warnings are not filtered
    # out by a stricter root logger.
    if logger.getEffectiveLevel() > logging.WARNING:
        logger.setLevel(logging.WARNING)


_install_pandoc_warning_collector()


@contextmanager
def _collect_pandoc_warnings(sink: Optional[list[str]]):
    """Route pandoc warnings into `sink` for the duration of the block."""
    if sink is None:
        yield
        return

    token = _pandoc_warning_sink.set(sink)
    try:
        yield
    finally:
        _pandoc_warning_sink.reset(token)


def convert_via_pandoc(
    markdown_text: str,
    reference_docx: str,
    source_dir: str,
    mermaid_dir: str,
    metadata: dict[str, str],
    warnings: Optional[list[str]] = None,
) -> io.BytesIO:
    """Run pandoc to convert markdown to DOCX. Returns BytesIO of the docx content.

    pypandoc requires `outputfile=<path>` for binary targets like docx (it
    cannot return the bytes directly). We write to a private temp file and
    read it back into a BytesIO.

    When `warnings` is given, pandoc's own warnings are appended to it — e.g.
    "Could not fetch resource logo.png" when an image cannot be resolved.
    """
    _ensure_pandoc()

    # Combine reference-docx dir and mermaid temp dir in resource-path
    resource_path = source_dir
    if mermaid_dir:
        resource_path = f"{mermaid_dir}{os.pathsep}{resource_path}"

    extra_args = [
        "--from", "gfm+raw_html",
        "--to", "docx",
        "--sandbox",
        "--reference-doc", reference_docx,
        "--resource-path", resource_path,
    ]

    for key, value in metadata.items():
        extra_args.extend(["--metadata", f"{key}={value}"])

    fd, out_path = tempfile.mkstemp(suffix=".docx", prefix="pandoc-")
    os.close(fd)
    try:
        try:
            with _collect_pandoc_warnings(warnings):
                pypandoc.convert_text(
                    markdown_text,
                    "docx",
                    format="gfm+raw_html",
                    extra_args=extra_args,
                    outputfile=out_path,
                )
        except Exception as e:
            raise RuntimeError(_map_pandoc_error(str(e))) from e

        with open(out_path, "rb") as f:
            raw_bytes = f.read()
        # Strip dangling image/oleObject relationships from the pandoc output
        # so that downstream python-docx consumers can open the document
        # without choking on references inherited from the reference template.
        return io.BytesIO(_strip_dangling_image_rels(raw_bytes))
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


# ── DOCX post-processing ──────────────────────────────────────────

def _strip_dangling_image_rels(docx_bytes):
    """Remove image/oleObject relationships from word/_rels/document.xml.rels
    that have no corresponding part in the zip.

    Some bundled reference templates declare image relationships whose target
    files are missing. Pandoc copies those relationships into its output and
    python-docx then refuses to open the document. This function cleans them
    up so the produced DOCX is openable.

    Returns the cleaned bytes (input returned unchanged on any read/write error).
    """
    try:
        with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zin:
            names = set(zin.namelist())
            rels_path = "word/_rels/document.xml.rels"
            if rels_path not in names:
                return docx_bytes
            rels_xml = zin.read(rels_path).decode("utf-8")
            root = etree.fromstring(rels_xml.encode("utf-8"))
            removed = 0
            for rel in list(root):
                rtype = rel.get("Type", "")
                if not rtype.endswith("/image") and not rtype.endswith("/oleObject"):
                    continue
                target = rel.get("Target", "")
                if not target:
                    continue
                # Targets in document.xml.rels are relative to word/, so
                # "media/image1.wmf" resolves to "word/media/image1.wmf".
                normalized = target.replace("\\", "/").lstrip("/")
                if normalized.startswith("word/"):
                    part_name = normalized
                else:
                    part_name = "word/" + normalized
                if part_name not in names:
                    root.remove(rel)
                    removed += 1
            if removed == 0:
                return docx_bytes
            new_rels = etree.tostring(
                root, xml_declaration=True, encoding="UTF-8", standalone=True
            )
            out_buf = io.BytesIO()
            with zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as zout:
                for item in zin.infolist():
                    data = zin.read(item.filename)
                    if item.filename == rels_path:
                        data = new_rels
                    zout.writestr(item, data)
            return out_buf.getvalue()
    except (zipfile.BadZipFile, etree.XMLSyntaxError, KeyError, OSError):
        return docx_bytes


# ── DOCX style overrides ─────────────────────────────────────

def _resolve_font_pair(
    override: object,
    profile: dict[str, Any],
    font_key: str,
    cjk_key: str,
) -> tuple[Optional[str], Optional[str]]:
    """Resolve one font pair, keeping explicit user fonts in both slots."""
    explicit = _clean_font(override)
    if explicit:
        return explicit, explicit
    font = profile.get(font_key)
    cjk_font = profile.get(cjk_key) or font
    return font, cjk_font


def _clean_font(value) -> Optional[str]:
    """Normalize a user-supplied font name: trimmed, empty means unset."""
    if not isinstance(value, str):
        return None
    return value.strip() or None


def _resolve_styles(doc: Document, names: tuple[str, ...],
                     ids: tuple[str, ...] = ()) -> list:
    """Find the styles an override applies to.

    Names are matched against the style's display name. Style ids are only
    consulted when no name matches, because ids are not portable between
    templates and would otherwise hit unrelated styles.
    """
    by_name = [style for style in doc.styles if style.name in names]
    if by_name:
        return by_name
    return [style for style in doc.styles if style.style_id in ids]


# The child order `w:rPr` and `w:pPr` require (ECMA-376). Word repairs a
# document whose style properties are out of sequence, so new elements have to
# be inserted at the right place rather than appended.
_RPR_SEQUENCE = (
    "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike",
    "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid",
    "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz",
    "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign",
    "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
)
_PPR_SEQUENCE = (
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr",
    "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs",
    "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct",
    "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid",
    "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap",
    "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl",
    "divId", "cnfStyle", "rPr", "sectPr", "pPrChange",
)

# Theme font attributes win over the explicit ones, so an override has to
# remove them — the reference templates use `majorHAnsi` for their headings.
_THEME_FONT_ATTRS = ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme")


def _get_or_add_ordered(parent, tag: str, sequence: tuple[str, ...]):
    """Return `tag` under `parent`, creating it at its schema position."""
    element = parent.find(qn(tag))
    if element is not None:
        return element

    element = parent.makeelement(qn(tag), {})
    successors = set(sequence[sequence.index(tag.split(":")[-1]) + 1:])
    for child in parent:
        if child.tag.split("}")[-1] in successors:
            child.addprevious(element)
            break
    else:
        parent.append(element)
    return element


def _normalize_order(parent, sequence: tuple[str, ...]) -> None:
    """Reorder the children of `parent` into the schema sequence.

    A few reference templates carry their style properties out of order
    (for example `w:shd` after `w:spacing`), which is schema invalid and
    makes Word offer to repair the document.
    """
    children = list(parent)

    def sort_key(item):
        index, child = item
        tag = child.tag.split("}")[-1]
        position = sequence.index(tag) if tag in sequence else len(sequence)
        return (position, index)

    ordered = [child for _, child in sorted(enumerate(children), key=sort_key)]
    if ordered == children:
        return
    for child in children:
        parent.remove(child)
    for child in ordered:
        parent.append(child)


def _normalize_style_properties(style) -> None:
    """Bring the style's run and paragraph properties into schema order."""
    element = style._element
    for tag, sequence in (("w:rPr", _RPR_SEQUENCE), ("w:pPr", _PPR_SEQUENCE)):
        properties = element.find(qn(tag))
        if properties is not None:
            _normalize_order(properties, sequence)


def _set_font(run_or_style, font_name: str, cjk_font: str | None = None) -> None:
    """Set the font on a run or style element, including east-asia."""
    rPr = run_or_style._element.get_or_add_rPr()
    rFonts = _get_or_add_ordered(rPr, "w:rFonts", _RPR_SEQUENCE)
    for attribute in _THEME_FONT_ATTRS:
        rFonts.attrib.pop(qn(f"w:{attribute}"), None)
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)
    rFonts.set(qn("w:eastAsia"), cjk_font or font_name)
    rFonts.set(qn("w:cs"), font_name)


def _set_font_size(run_or_style, size_pt: float) -> None:
    """Set font size on a run or style element."""
    rPr = run_or_style._element.get_or_add_rPr()
    half_pts = str(int(round(size_pt * 2)))
    _get_or_add_ordered(rPr, "w:sz", _RPR_SEQUENCE).set(qn("w:val"), half_pts)
    # Complex-script size travels separately from the Latin one.
    _get_or_add_ordered(rPr, "w:szCs", _RPR_SEQUENCE).set(qn("w:val"), half_pts)


def _set_line_spacing(paragraph_format, spacing: float) -> None:
    """Set line spacing on a paragraph format."""
    line_value = int(round(spacing * 240))
    pPr = paragraph_format._element.get_or_add_pPr()
    spacing_el = _get_or_add_ordered(pPr, "w:spacing", _PPR_SEQUENCE)
    spacing_el.set(qn("w:line"), str(line_value))
    spacing_el.set(qn("w:lineRule"), "auto")


def _set_shading(paragraph_format, fill_color: str) -> None:
    """Set paragraph shading (background color)."""
    pPr = paragraph_format._element.get_or_add_pPr()
    shd = _get_or_add_ordered(pPr, "w:shd", _PPR_SEQUENCE)
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_color)


def _set_font_color(run_or_style, color_hex: str) -> None:
    """Set text color on a run or style."""
    rPr = run_or_style._element.get_or_add_rPr()
    _get_or_add_ordered(rPr, "w:color", _RPR_SEQUENCE).set(qn("w:val"), color_hex)


def _apply_to_styles(doc: Document, names: tuple[str, ...], *, ids: tuple[str, ...] = (),
                     font=None, cjk_font=None, size=None,
                     color=None, line_spacing=None) -> bool:
    """Apply font/size/color/line_spacing to matching styles. Returns True
    if at least one style was found and modified.
    """
    matched = False
    for style in _resolve_styles(doc, names, ids):
        matched = True
        if font:
            _set_font(style, font, cjk_font)
        if size:
            _set_font_size(style, size)
        if color:
            _set_font_color(style, color)
        if line_spacing and isinstance(style, ParagraphStyle):
            _set_line_spacing(style.paragraph_format, line_spacing)
        _normalize_style_properties(style)
    return matched


def apply_document_metadata(doc: Document, title: str) -> None:
    """Write the document title into the DOCX core properties."""
    if not title:
        return
    doc.core_properties.title = title


def apply_style_overrides(doc: Document, style_profile: str, params: dict) -> list[str]:
    """Apply font/size/spacing overrides to Normal and Heading styles.

    Returns a list of human-readable warnings when a non-template profile
    requests overrides but the reference document does not contain the
    expected style names. Empty list on full success.
    """
    profile = PROFILE_DEFAULTS.get(style_profile, {})
    warnings: list[str] = []

    # Resolve effective values: user param > profile default > None (skip)
    body_font, body_cjk = _resolve_font_pair(
        params.get("body_font"), profile, "body_font", "body_cjk_font"
    )
    body_size = parse_pt(params.get("body_size_pt")) or profile.get("body_size_pt")
    line_spacing = parse_spacing(params.get("line_spacing")) or profile.get("line_spacing")

    h1_font, h1_cjk = _resolve_font_pair(
        params.get("heading1_font"), profile, "heading1_font", "heading1_cjk_font"
    )
    h1_size = parse_pt(params.get("heading1_size_pt")) or profile.get("heading1_size_pt")
    h2_font, h2_cjk = _resolve_font_pair(
        params.get("heading2_font"), profile, "heading2_font", "heading2_cjk_font"
    )
    h2_size = parse_pt(params.get("heading2_size_pt")) or profile.get("heading2_size_pt")
    h3_font, h3_cjk = _resolve_font_pair(
        params.get("heading3_font"), profile, "heading3_font", "heading3_cjk_font"
    )
    h3_size = parse_pt(params.get("heading3_size_pt")) or profile.get("heading3_size_pt")

    # Normal style + aliases (BodyText, Compact, etc.)
    effective_color = "000000" if style_profile != "template" else None
    if not _apply_to_styles(doc, NORMAL_STYLE_NAMES,
                             font=body_font, cjk_font=body_cjk, size=body_size,
                             color=effective_color, line_spacing=line_spacing):
        if style_profile != "template":
            warnings.append(
                f"None of the body style names {NORMAL_STYLE_NAMES} were found in the "
                f"reference template; body font/size/spacing overrides were not applied."
            )

    # Heading styles + aliases
    if not _apply_to_styles(doc, HEADING_ALIASES["Heading 1"],
                             font=h1_font, cjk_font=h1_cjk, size=h1_size,
                             color=effective_color):
        if style_profile != "template":
            warnings.append(
                f"Heading 1 style not found in reference template; heading 1 overrides were not applied."
            )
    if not _apply_to_styles(doc, HEADING_ALIASES["Heading 2"],
                             font=h2_font, cjk_font=h2_cjk, size=h2_size,
                             color=effective_color):
        if style_profile != "template":
            warnings.append(
                f"Heading 2 style not found in reference template; heading 2 overrides were not applied."
            )
    if not _apply_to_styles(doc, HEADING_ALIASES["Heading 3"],
                             font=h3_font, cjk_font=h3_cjk, size=h3_size,
                             color=effective_color):
        if style_profile != "template":
            warnings.append(
                f"Heading 3 style not found in reference template; heading 3 overrides were not applied."
            )

    # Technical profile: code styles
    if style_profile == "technical":
        code_styles = _resolve_styles(doc, CODE_STYLE_NAMES, CODE_STYLE_IDS)
        for cs in code_styles:
            _set_font(cs, "Consolas")
            _set_font_size(cs, 10)
            _set_font_color(cs, "000000")
            # Shading is a paragraph property; character styles (e.g.
            # VerbatimChar) have no paragraph_format and would raise.
            if isinstance(cs, ParagraphStyle):
                _set_shading(cs.paragraph_format, "F3F4F6")
            _normalize_style_properties(cs)
        if not code_styles:
            warnings.append(
                f"Technical profile: no code style ({CODE_STYLE_NAMES}) found in reference template."
            )

    # Page margins: user override > profile default > skip
    margin_top = parse_mm(params.get("margin_top_mm")) or profile.get("margin_top_mm")
    margin_bottom = parse_mm(params.get("margin_bottom_mm")) or profile.get("margin_bottom_mm")
    margin_left = parse_mm(params.get("margin_left_mm")) or profile.get("margin_left_mm")
    margin_right = parse_mm(params.get("margin_right_mm")) or profile.get("margin_right_mm")

    if any([margin_top, margin_bottom, margin_left, margin_right]):
        for section in doc.sections:
            if margin_top:
                section.top_margin = Cm(margin_top / 10)
            if margin_bottom:
                section.bottom_margin = Cm(margin_bottom / 10)
            if margin_left:
                section.left_margin = Cm(margin_left / 10)
            if margin_right:
                section.right_margin = Cm(margin_right / 10)

    return warnings


# ── Dify Tool entry point ────────────────────────────────────

# Characters that can appear in "falsy" string representations
_FALSY_STRINGS = frozenset({"false", "0", "no", "off", "disabled", "n", ""})


def _coerce_bool(value) -> bool:
    """Coerce a value to bool, handling Dify string-form booleans."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in _FALSY_STRINGS
    return bool(value)


class Md2DocxTool(Tool):
    """Dify Tool: convert Markdown to DOCX."""

    def _invoke(
        self, parameters: dict
    ) -> Generator[ToolInvokeMessage, None, None]:
        custom_template_path = None
        mermaid_dir = ""
        stage = "start"
        warnings: list[str] = []

        try:
            markdown_content = parameters.get("markdown_content") or ""
            if not markdown_content.strip():
                yield self.create_json_message({"status": "error", "stage": "validation", "message": "markdown_content is empty"})
                yield self.create_text_message(
                    "Error: markdown_content is empty. Please provide Markdown text to convert."
                )
                return

            # Reject oversized inputs to avoid OOM in the Dify plugin sandbox.
            markdown_bytes_len = len(markdown_content.encode("utf-8"))
            if markdown_bytes_len > MAX_MARKDOWN_BYTES:
                size_mb = MAX_MARKDOWN_BYTES // (1024 * 1024)
                msg = (
                    f"markdown_content is {markdown_bytes_len} bytes, exceeds the "
                    f"{size_mb}MB limit. Split the document or raise the limit."
                )
                yield self.create_json_message({"status": "error", "stage": "validation", "message": msg})
                yield self.create_text_message(f"Error: {msg}")
                return

            stage = "validation"
            title = sanitize_filename(parameters.get("title") or "Document")
            style_profile = normalize_profile(parameters.get("style_profile"))
            language_setting = parameters.get("reference_language", "auto")
            mermaid_enabled = _coerce_bool(parameters.get("mermaid_enabled", True))

            # Resolve language
            stage = "language_detection"
            reference_language = resolve_language(language_setting, markdown_content)

            # Resolve template
            stage = "template_resolution"
            custom_template = parameters.get("custom_template")
            if custom_template:
                fd, custom_template_path = tempfile.mkstemp(suffix=".docx", prefix="custom-template-")
                os.close(fd)
                try:
                    if isinstance(custom_template, (bytes, bytearray)):
                        with open(custom_template_path, "wb") as f:
                            f.write(custom_template)
                    elif isinstance(custom_template, str):
                        # DOCX is a binary zip; a plain str cannot be safely
                        # decoded back to its original bytes. Reject it with
                        # a clear warning rather than silently producing a
                        # corrupted file.
                        os.unlink(custom_template_path)
                        custom_template_path = None
                        warnings.append(
                            "custom_template: received a string, expected raw bytes. "
                            "The custom template was ignored; the built-in template is used."
                        )
                    else:
                        os.unlink(custom_template_path)
                        custom_template_path = None
                        warnings.append(
                            f"custom_template: unsupported type {type(custom_template).__name__}; "
                            "the custom template was ignored."
                        )
                except Exception as e:
                    # Clean up partial file and continue without custom template
                    if os.path.exists(custom_template_path):
                        try:
                            os.unlink(custom_template_path)
                        except OSError:
                            pass
                    custom_template_path = None
                    warnings.append(f"custom_template: failed to write temp file ({e}); ignored.")

            plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            reference_docx = resolve_template(
                style_profile, reference_language, custom_template_path, plugin_root
            )

            # Mermaid preprocessing
            stage = "mermaid_preprocessing"
            mermaid_api_url = None
            has_mermaid_blocks = (
                mermaid_enabled and MERMAID_BLOCK_RE.search(markdown_content) is not None
            )
            if has_mermaid_blocks:
                try:
                    mermaid_api_url = validate_api_url(parameters.get("mermaid_api_url"))
                except ValueError as e:
                    raise RuntimeError(str(e)) from e
            processed_md, mermaid_count, mermaid_dir, mermaid_errors = preprocess_mermaid(
                markdown_content, enabled=mermaid_enabled, api_url=mermaid_api_url
            )
            warnings.extend(mermaid_errors)

            # Pandoc metadata
            metadata = build_pandoc_metadata(
                style_profile,
                parameters.get("body_font"),
                parse_pt(parameters.get("body_size_pt")),
                parse_spacing(parameters.get("line_spacing")),
            )

            # Convert via pandoc
            stage = "pandoc_conversion"
            source_dir = os.path.dirname(reference_docx)
            pandoc_warnings: list[str] = []
            docx_io = convert_via_pandoc(
                processed_md, reference_docx, source_dir, mermaid_dir, metadata,
                warnings=pandoc_warnings,
            )
            warnings.extend(pandoc_warnings)

            # Apply style overrides
            stage = "style_overrides"
            doc = Document(docx_io)
            apply_document_metadata(doc, title)
            style_warnings = apply_style_overrides(doc, style_profile, parameters)
            warnings.extend(style_warnings)

            # Save to BytesIO (and strip any dangling media rels that python-docx
            # may have re-introduced on round-trip)
            output_io = io.BytesIO()
            doc.save(output_io)
            docx_bytes = _strip_dangling_image_rels(output_io.getvalue())

            # Messages
            size_kb = len(docx_bytes) / 1024
            summary_parts = [
                f"DOCX generated: {title}.docx ({size_kb:.1f} KB)",
                f"Style: {style_profile} | Language: {reference_language}",
            ]
            if mermaid_count > 0:
                summary_parts.append(f"Mermaid diagrams rendered: {mermaid_count}")
            if mermaid_errors:
                failed = len(mermaid_errors)
                summary_parts.append(
                    f"Warning: {failed} Mermaid diagram(s) failed to render and were kept as code blocks."
                )

            yield self.create_text_message("\n".join(summary_parts))
            # Dify treats every json message as a discrete output, so the whole
            # result must be a single message.
            yield self.create_json_message({
                "status": "success",
                "stage": "complete",
                "file": f"{title}.docx",
                "size_kb": round(size_kb, 1),
                "warnings": warnings,
            })
            yield self.create_blob_message(
                blob=docx_bytes,
                meta={
                    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "filename": f"{title}.docx",
                },
            )

        except Exception as e:
            # Keep whatever was collected before the failure: the caller needs
            # to know why the document is incomplete.
            payload = {"status": "error", "stage": stage, "message": str(e)}
            if warnings:
                payload["warnings"] = warnings
            yield self.create_json_message(payload)
            yield self.create_text_message(
                f"md2docx conversion failed at stage '{stage}': {e}"
            )

        finally:
            if custom_template_path and os.path.exists(custom_template_path):
                try:
                    os.unlink(custom_template_path)
                except OSError:
                    pass
            if mermaid_dir and os.path.isdir(mermaid_dir):
                shutil.rmtree(mermaid_dir, ignore_errors=True)
