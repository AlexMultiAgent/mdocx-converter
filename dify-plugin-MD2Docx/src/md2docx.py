"""
md2docx — Convert Markdown to DOCX with templates, Mermaid, and style presets.

Ported from mdocx-converter VS Code extension.
"""

import os
import re
import io
import shutil
import tempfile
import threading
from typing import Optional, Any

import requests
import pypandoc
from docx import Document
from docx.shared import Cm
from docx.oxml.ns import qn
from lxml import etree

# ── Regex ───────────────────────────────────────────────────

MERMAID_BLOCK_RE = re.compile(r"```mermaid[^\n]*\r?\n([\s\S]*?)```", re.IGNORECASE)
CJK_CHAR_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
LATIN_CHAR_RE = re.compile(r"[A-Za-z]")

# ── Profile defaults (ported from getProfileDocxDefaults) ───

PROFILE_DEFAULTS: dict[str, dict[str, Any]] = {
    "academic": {
        "body_font": "SimSun",
        "body_size_pt": 12,
        "heading1_font": "SimHei",
        "heading1_size_pt": 16,
        "heading2_font": "SimHei",
        "heading2_size_pt": 14,
        "heading3_font": "SimHei",
        "heading3_size_pt": 12,
        "line_spacing": 1.5,
    },
    "business": {
        "body_font": "Arial",
        "body_size_pt": 11,
        "heading1_font": "Arial",
        "heading1_size_pt": 18,
        "heading2_font": "Arial",
        "heading2_size_pt": 14,
        "heading3_font": "Arial",
        "heading3_size_pt": 12,
        "line_spacing": 1.3,
    },
    "technical": {
        "body_font": "Arial",
        "body_size_pt": 11,
        "heading1_font": "Arial",
        "heading1_size_pt": 16,
        "heading2_font": "Arial",
        "heading2_size_pt": 14,
        "heading3_font": "Arial",
        "heading3_size_pt": 12,
        "line_spacing": 1.25,
    },
    "government": {
        "body_font": "FangSong",
        "body_size_pt": 16,
        "heading1_font": "SimHei",
        "heading1_size_pt": 16,
        "heading2_font": "KaiTi",
        "heading2_size_pt": 16,
        "heading3_font": "FangSong",
        "heading3_size_pt": 16,
        "line_spacing": 1.75,
    },
    "template": {},
}

# ── Pandoc metadata per profile (ported from STYLE_PROFILE_METADATA) ──

PROFILE_METADATA: dict[str, dict[str, str]] = {
    "template": {},
    "academic": {
        "mainfont": "Times New Roman",
        "CJKmainfont": "SimSun",
        "fontsize": "12pt",
        "linestretch": "1.5",
    },
    "business": {
        "mainfont": "Arial",
        "CJKmainfont": "Microsoft YaHei",
        "fontsize": "11pt",
        "linestretch": "1.3",
    },
    "technical": {
        "mainfont": "Arial",
        "CJKmainfont": "Microsoft YaHei",
        "monofont": "Consolas",
        "fontsize": "11pt",
        "linestretch": "1.25",
    },
    "government": {
        "mainfont": "Times New Roman",
        "CJKmainfont": "FangSong",
        "fontsize": "16pt",
        "linestretch": "1.75",
    },
}

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
    "government": {
        "english": "reference_english_government.docx",
        "chinese": "reference_chinese_government.docx",
    },
}

VALID_PROFILES = {"template", "academic", "business", "technical", "government"}

# Style name aliases used by some reference.docx templates
NORMAL_STYLE_NAMES = ("Normal", "a", "a1", "Text", "BodyText", "Body Text",
                       "FirstParagraph", "Compact")
HEADING_ALIASES = {
    "Heading 1": ("Heading 1", "1"),
    "Heading 2": ("Heading 2", "2", "21"),
    "Heading 3": ("Heading 3", "3", "31"),
}
CODE_STYLE_NAMES = ("SourceCode", "VerbatimChar", "Code")


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


def parse_pt(value) -> Optional[float]:
    """Parse a pt value, return None if 0, negative, or non-numeric."""
    if value is None:
        return None
    # Guard against bool (subclass of int): float(True) == 1.0
    if isinstance(value, bool):
        return None
    try:
        v = float(value)
        return v if v > 0 else None
    except (TypeError, ValueError):
        return None


def parse_spacing(value) -> Optional[float]:
    """Parse line spacing, return None if 0 or invalid."""
    return parse_pt(value)


def parse_mm(value) -> Optional[float]:
    """Parse mm value, return None if 0 or invalid."""
    return parse_pt(value)


def mm_to_twips(mm: float) -> int:
    """Convert millimeters to twips (1 mm ≈ 56.69 twips)."""
    return round(mm * 56.6929133858)


# ── Title sanitization ───────────────────────────────────────

_FILENAME_BAD_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename(name: str) -> str:
    """Replace characters illegal in filenames with underscores."""
    return _FILENAME_BAD_CHARS_RE.sub("_", name).strip() or "Document"


# ── Mermaid preprocessing ────────────────────────────────────

MERMAID_INK_URL = "https://mermaid.ink/img"


def render_mermaid_via_api(diagram: str) -> bytes:
    """Render a Mermaid diagram via the Mermaid Ink API. Returns PNG bytes."""
    resp = requests.post(
        MERMAID_INK_URL,
        json={"code": diagram},
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.content


def preprocess_mermaid(markdown_text: str, enabled: bool = True) -> tuple[str, int, str, list[str]]:
    """Extract ```mermaid blocks, render to PNGs via API, replace with image refs.

    Returns (processed_markdown, mermaid_count, temp_dir, errors).
    Caller must clean up temp_dir via shutil.rmtree after pandoc conversion.
    """
    if not enabled:
        return markdown_text, 0, "", []

    matches = list(MERMAID_BLOCK_RE.finditer(markdown_text))
    if not matches:
        return markdown_text, 0, "", []

    temp_dir = tempfile.mkdtemp(prefix="mermaid-")
    errors: list[str] = []

    parts = []
    last_end = 0
    count = 0

    for i, match in enumerate(matches, 1):
        diagram = match.group(1).strip()
        start = match.start()

        parts.append(markdown_text[last_end:start])

        try:
            png_bytes = render_mermaid_via_api(diagram)
            png_path = os.path.join(temp_dir, f"diagram-{i}.png")
            with open(png_path, "wb") as f:
                f.write(png_bytes)
            # Wrap path in angle brackets to handle paths with spaces on Windows
            parts.append(f"![Mermaid Diagram {i}](<{png_path}>)\n\n")
            count += 1
        except Exception as e:
            errors.append(f"Diagram {i}: {e}")
            parts.append(match.group(0) + "\n\n")

        last_end = match.end()

    parts.append(markdown_text[last_end:])
    return "".join(parts), count, temp_dir, errors


# ── Pandoc conversion ────────────────────────────────────────

_pandoc_lock = threading.Lock()


def _ensure_pandoc() -> None:
    """Check for pandoc; download on first use via pypandoc (thread-safe)."""
    try:
        pypandoc.get_pandoc_version()
    except OSError:
        with _pandoc_lock:
            # Double-check inside lock — another thread may have finished downloading
            try:
                pypandoc.get_pandoc_version()
            except OSError:
                pypandoc.download_pandoc()


def build_pandoc_metadata(
    style_profile: str,
    body_font: Optional[str],
    body_size_pt: Optional[float],
    line_spacing: Optional[float],
) -> dict[str, str]:
    """Build the pandoc --metadata dict, layering profile defaults + user overrides."""
    metadata = dict(PROFILE_METADATA.get(style_profile, {}))

    if body_font and body_font.strip():
        metadata["mainfont"] = body_font.strip()
        metadata["CJKmainfont"] = body_font.strip()
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
    if any(kw in msg_lower for kw in ("cannot decode image", "image", "could not fetch resource", "not found")):
        return "Pandoc could not resolve one or more images. Check that all image paths in the Markdown are valid and accessible."
    if any(kw in msg_lower for kw in ("unknown reader", "unknown extension", "mermaid")):
        return "Pandoc encountered syntax it could not handle. Check for unsupported Markdown constructs or malformed Mermaid blocks."
    if any(kw in msg_lower for kw in ("not a valid docx", "reference docx", "could not read")):
        return "Pandoc could not read the reference template. The uploaded .docx may be corrupted or not in the expected format."
    return f"Pandoc conversion failed: {message}"


def convert_via_pandoc(
    markdown_text: str,
    reference_docx: str,
    source_dir: str,
    mermaid_dir: str,
    metadata: dict[str, str],
) -> io.BytesIO:
    """Run pandoc to convert markdown to DOCX. Returns BytesIO of the docx content."""
    _ensure_pandoc()

    # Combine reference-docx dir and mermaid temp dir in resource-path
    resource_path = source_dir
    if mermaid_dir:
        resource_path = f"{mermaid_dir}{os.pathsep}{resource_path}"

    extra_args = [
        "--from", "gfm+raw_html",
        "--to", "docx",
        "--reference-doc", reference_docx,
        "--resource-path", resource_path,
    ]

    for key, value in metadata.items():
        extra_args.extend(["--metadata", f"{key}={value}"])

    try:
        output = pypandoc.convert_text(
            markdown_text,
            "docx",
            format="gfm+raw_html",
            extra_args=extra_args,
        )
    except Exception as e:
        raise RuntimeError(_map_pandoc_error(str(e))) from e

    return io.BytesIO(output)


# ── DOCX style overrides ─────────────────────────────────────

def _set_font(run_or_style, font_name: str) -> None:
    """Set the font on a run or style element, including east-asia."""
    rPr = run_or_style._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = etree.SubElement(rPr, qn("w:rFonts"))
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)
    rFonts.set(qn("w:eastAsia"), font_name)


def _set_font_size(run_or_style, size_pt: float) -> None:
    """Set font size on a run or style element."""
    rPr = run_or_style._element.get_or_add_rPr()
    sz = rPr.find(qn("w:sz"))
    if sz is None:
        sz = etree.SubElement(rPr, qn("w:sz"))
    half_pts = str(int(round(size_pt * 2)))
    sz.set(qn("w:val"), half_pts)


def _set_line_spacing(paragraph_format, spacing: float) -> None:
    """Set line spacing on a paragraph format."""
    line_value = int(round(spacing * 240))
    pPr = paragraph_format._element.get_or_add_pPr()
    spacing_el = pPr.find(qn("w:spacing"))
    if spacing_el is None:
        spacing_el = etree.SubElement(pPr, qn("w:spacing"))
    spacing_el.set(qn("w:line"), str(line_value))
    spacing_el.set(qn("w:lineRule"), "auto")


def _set_shading(paragraph_format, fill_color: str) -> None:
    """Set paragraph shading (background color)."""
    pPr = paragraph_format._element.get_or_add_pPr()
    shd = pPr.find(qn("w:shd"))
    if shd is None:
        shd = etree.SubElement(pPr, qn("w:shd"))
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_color)


def _set_font_color(run_or_style, color_hex: str) -> None:
    """Set text color on a run or style."""
    rPr = run_or_style._element.get_or_add_rPr()
    color = rPr.find(qn("w:color"))
    if color is None:
        color = etree.SubElement(rPr, qn("w:color"))
    color.set(qn("w:val"), color_hex)


def _apply_to_styles(doc: Document, names: tuple[str, ...], *, font=None, size=None,
                     color=None, line_spacing=None) -> None:
    """Apply font, size, color, and line_spacing to matching style names, ignoring missing ones."""
    for name in names:
        try:
            style = doc.styles[name]
            if font:
                _set_font(style, font)
            if size:
                _set_font_size(style, size)
            if color:
                _set_font_color(style, color)
            if line_spacing:
                _set_line_spacing(style.paragraph_format, line_spacing)
        except KeyError:
            pass


def apply_style_overrides(doc: Document, style_profile: str, params: dict) -> None:
    """Apply font/size/spacing overrides to Normal and Heading styles."""
    profile = PROFILE_DEFAULTS.get(style_profile, {})

    # Resolve effective values: user param > profile default > None (skip)
    body_font = params.get("body_font") or profile.get("body_font")
    body_size = parse_pt(params.get("body_size_pt")) or profile.get("body_size_pt")
    line_spacing = parse_spacing(params.get("line_spacing")) or profile.get("line_spacing")

    h1_font = params.get("heading1_font") or profile.get("heading1_font")
    h1_size = parse_pt(params.get("heading1_size_pt")) or profile.get("heading1_size_pt")
    h2_font = params.get("heading2_font") or profile.get("heading2_font")
    h2_size = parse_pt(params.get("heading2_size_pt")) or profile.get("heading2_size_pt")
    h3_font = params.get("heading3_font") or profile.get("heading3_font")
    h3_size = parse_pt(params.get("heading3_size_pt")) or profile.get("heading3_size_pt")

    # Normal style + aliases (BodyText, Compact, etc.)
    effective_color = "000000" if style_profile != "template" else None
    _apply_to_styles(doc, NORMAL_STYLE_NAMES, font=body_font, size=body_size,
                     color=effective_color, line_spacing=line_spacing)

    # Heading styles + aliases
    _apply_to_styles(doc, HEADING_ALIASES["Heading 1"], font=h1_font, size=h1_size,
                     color=effective_color)
    _apply_to_styles(doc, HEADING_ALIASES["Heading 2"], font=h2_font, size=h2_size,
                     color=effective_color)
    _apply_to_styles(doc, HEADING_ALIASES["Heading 3"], font=h3_font, size=h3_size,
                     color=effective_color)

    # Technical profile: code styles
    if style_profile == "technical":
        for code_style_name in CODE_STYLE_NAMES:
            try:
                cs = doc.styles[code_style_name]
                _set_font(cs, "Consolas")
                _set_font_size(cs, 10)
                _set_font_color(cs, "000000")
                _set_shading(cs.paragraph_format, "F3F4F6")
            except KeyError:
                pass

    # Page margins
    margin_top = parse_mm(params.get("margin_top_mm"))
    margin_bottom = parse_mm(params.get("margin_bottom_mm"))
    margin_left = parse_mm(params.get("margin_left_mm"))
    margin_right = parse_mm(params.get("margin_right_mm"))

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


# ── Dify Tool entry point ────────────────────────────────────

from typing import Generator
from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

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

        try:
            markdown_content = parameters.get("markdown_content") or ""
            if not markdown_content.strip():
                yield self.create_text_message(
                    "Error: markdown_content is empty. Please provide Markdown text to convert."
                )
                return

            title = sanitize_filename(parameters.get("title") or "Document")
            style_profile = normalize_profile(parameters.get("style_profile"))
            language_setting = parameters.get("reference_language", "auto")
            mermaid_enabled = _coerce_bool(parameters.get("mermaid_enabled", True))

            # Resolve language
            reference_language = resolve_language(language_setting, markdown_content)

            # Resolve template
            custom_template = parameters.get("custom_template")
            if custom_template:
                fd, custom_template_path = tempfile.mkstemp(suffix=".docx")
                os.close(fd)
                if isinstance(custom_template, bytes):
                    with open(custom_template_path, "wb") as f:
                        f.write(custom_template)
                elif isinstance(custom_template, str):
                    # Docx is binary — encode string and write as bytes
                    with open(custom_template_path, "wb") as f:
                        f.write(custom_template.encode("utf-8", errors="surrogateescape"))
                else:
                    # Unexpected type (e.g. file-like object) — skip silently
                    os.unlink(custom_template_path)
                    custom_template_path = None

            plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            reference_docx = resolve_template(
                style_profile, reference_language, custom_template_path, plugin_root
            )

            # Mermaid preprocessing
            processed_md, mermaid_count, mermaid_dir, mermaid_errors = preprocess_mermaid(
                markdown_content, enabled=mermaid_enabled
            )

            # Pandoc metadata
            metadata = build_pandoc_metadata(
                style_profile,
                parameters.get("body_font"),
                parse_pt(parameters.get("body_size_pt")),
                parse_spacing(parameters.get("line_spacing")),
            )

            # Convert via pandoc
            source_dir = os.path.dirname(reference_docx)
            docx_io = convert_via_pandoc(
                processed_md, reference_docx, source_dir, mermaid_dir, metadata
            )

            # Apply style overrides
            doc = Document(docx_io)
            apply_style_overrides(doc, style_profile, parameters)

            # Save to BytesIO
            output_io = io.BytesIO()
            doc.save(output_io)
            output_io.seek(0)
            docx_bytes = output_io.read()

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
            yield self.create_blob_message(
                blob=docx_bytes,
                meta={
                    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                },
                save_as=f"{title}.docx",
            )

        except Exception as e:
            yield self.create_text_message(
                f"md2docx conversion failed: {e}"
            )

        finally:
            if custom_template_path and os.path.exists(custom_template_path):
                os.unlink(custom_template_path)
            if mermaid_dir and os.path.isdir(mermaid_dir):
                shutil.rmtree(mermaid_dir, ignore_errors=True)
