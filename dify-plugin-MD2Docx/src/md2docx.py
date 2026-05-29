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
