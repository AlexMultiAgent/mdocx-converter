"""
md2docx — Convert Markdown to DOCX with templates, Mermaid, and style presets.

Ported from mdocx-converter VS Code extension.
"""

import os
import re
import io
import tempfile
import zlib
import base64
from typing import Optional

import requests
import pypandoc
from docx import Document
from docx.shared import Pt, Cm, Emu, Twips
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

# ── Regex ───────────────────────────────────────────────────

MERMAID_BLOCK_RE = re.compile(r"```mermaid[^\n]*\r?\n([\s\S]*?)```", re.IGNORECASE)
CJK_CHAR_RE = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
LATIN_CHAR_RE = re.compile(r"[A-Za-z]")

# ── Profile defaults (ported from getProfileDocxDefaults) ───

PROFILE_DEFAULTS: dict[str, dict[str, any]] = {
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
        "linestretch": "1.25",
    },
    "technical": {
        "mainfont": "Arial",
        "CJKmainfont": "Microsoft YaHei",
        "monofont": "Consolas",
        "fontsize": "11pt",
        "linestretch": "1.2",
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
}

VALID_PROFILES = {"template", "academic", "business", "technical"}


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


def preprocess_mermaid(markdown_text: str, enabled: bool = True) -> tuple[str, int]:
    """Extract ```mermaid blocks, render to PNGs via API, replace with image refs.

    Returns (processed_markdown, mermaid_count).
    """
    if not enabled:
        return markdown_text, 0

    matches = list(MERMAID_BLOCK_RE.finditer(markdown_text))
    if not matches:
        return markdown_text, 0

    temp_dir = tempfile.mkdtemp(prefix="mermaid-")

    parts = []
    last_end = 0
    count = 0

    for i, match in enumerate(matches, 1):
        diagram = match.group(1).strip()
        start = match.start()

        # Append text before this mermaid block
        parts.append(markdown_text[last_end:start])

        # Render diagram
        try:
            png_bytes = render_mermaid_via_api(diagram)
            png_path = os.path.join(temp_dir, f"diagram-{i}.png")
            with open(png_path, "wb") as f:
                f.write(png_bytes)
            parts.append(f"![Mermaid Diagram {i}]({png_path})\n\n")
            count += 1
        except Exception as e:
            # On render failure, keep the original mermaid block as code
            parts.append(match.group(0) + "\n\n")

        last_end = match.end()

    parts.append(markdown_text[last_end:])
    return "".join(parts), count


# ── Pandoc conversion ────────────────────────────────────────

def _ensure_pandoc() -> None:
    """Check for pandoc; download on first use via pypandoc."""
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

    if body_font:
        metadata["mainfont"] = body_font
        metadata["CJKmainfont"] = body_font
    if body_size_pt:
        metadata["fontsize"] = f"{body_size_pt}pt"
    if line_spacing:
        metadata["linestretch"] = str(line_spacing)

    return {k: v for k, v in metadata.items() if v.strip()}


def convert_via_pandoc(
    markdown_text: str,
    reference_docx: str,
    source_dir: str,
    metadata: dict[str, str],
) -> io.BytesIO:
    """Run pandoc to convert markdown to DOCX. Returns BytesIO of the docx content."""
    _ensure_pandoc()

    extra_args = [
        "--from", "gfm+raw_html",
        "--to", "docx",
        "--reference-doc", reference_docx,
        "--resource-path", source_dir,
    ]

    for key, value in metadata.items():
        extra_args.extend(["--metadata", f"{key}={value}"])

    output = pypandoc.convert_text(
        markdown_text,
        "docx",
        format="gfm+raw_html",
        extra_args=extra_args,
    )

    return io.BytesIO(output)


# ── DOCX style overrides ─────────────────────────────────────

def _set_font(run_or_style, font_name: str) -> None:
    """Set the font on a run or style element, including east-asia."""
    rPr = run_or_style._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        from lxml import etree
        rFonts = etree.SubElement(rPr, qn("w:rFonts"))
    rFonts.set(qn("w:ascii"), font_name)
    rFonts.set(qn("w:hAnsi"), font_name)
    rFonts.set(qn("w:eastAsia"), font_name)


def _set_font_size(run_or_style, size_pt: float) -> None:
    """Set font size on a run or style element."""
    rPr = run_or_style._element.get_or_add_rPr()
    sz = rPr.find(qn("w:sz"))
    if sz is None:
        from lxml import etree
        sz = etree.SubElement(rPr, qn("w:sz"))
    half_pts = str(int(round(size_pt * 2)))
    sz.set(qn("w:val"), half_pts)


def _set_line_spacing(paragraph_format, spacing: float) -> None:
    """Set line spacing on a paragraph format."""
    line_value = int(round(spacing * 240))
    pPr = paragraph_format._element.get_or_add_pPr()
    spacing_el = pPr.find(qn("w:spacing"))
    if spacing_el is None:
        from lxml import etree
        spacing_el = etree.SubElement(pPr, qn("w:spacing"))
    spacing_el.set(qn("w:line"), str(line_value))
    spacing_el.set(qn("w:lineRule"), "auto")


def _set_shading(paragraph_format, fill_color: str) -> None:
    """Set paragraph shading (background color)."""
    pPr = paragraph_format._element.get_or_add_pPr()
    shd = pPr.find(qn("w:shd"))
    if shd is None:
        from lxml import etree
        shd = etree.SubElement(pPr, qn("w:shd"))
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill_color)


def _set_font_color(run_or_style, color_hex: str) -> None:
    """Set text color on a run or style."""
    rPr = run_or_style._element.get_or_add_rPr()
    color = rPr.find(qn("w:color"))
    if color is None:
        from lxml import etree
        color = etree.SubElement(rPr, qn("w:color"))
    color.set(qn("w:val"), color_hex)


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

    # Normal style
    normal = doc.styles["Normal"]
    if body_font:
        _set_font(normal, body_font)
    if body_size:
        _set_font_size(normal, body_size)
    if line_spacing:
        _set_line_spacing(normal.paragraph_format, line_spacing)

    # Heading styles
    for style_name, font, size in [
        ("Heading 1", h1_font, h1_size),
        ("Heading 2", h2_font, h2_size),
        ("Heading 3", h3_font, h3_size),
    ]:
        try:
            style = doc.styles[style_name]
            if font:
                _set_font(style, font)
            if size:
                _set_font_size(style, size)
        except KeyError:
            pass

    # Technical profile: code styles
    if style_profile == "technical":
        for code_style_name in ("SourceCode", "VerbatimChar"):
            try:
                cs = doc.styles[code_style_name]
                _set_font(cs, "Consolas")
                _set_font_size(cs, 10)
                _set_font_color(cs, "1F2937")
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
