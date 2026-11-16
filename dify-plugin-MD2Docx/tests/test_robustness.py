"""
Tests for the failure paths of the conversion.

Every one of them is about what the plugin does when something goes wrong:
it must clean up after itself, it must stop when it is told to, and it must
not hand the caller more than it needs to know.
"""
import glob
import os
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

TEMPLATE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "multi-templates"
)


def _mermaid_temp_dirs():
    return set(glob.glob(os.path.join(tempfile.gettempdir(), "mermaid-*")))


class TestTemporaryDirectoryCleanup:
    def test_a_failed_preparation_removes_its_directory(self, monkeypatch):
        """A failure after the directory was created must not leave it behind."""
        from md2docx import preprocess_mermaid

        monkeypatch.setattr(
            "md2docx.render_mermaid_via_api",
            lambda diagram, api_url=None, timeout=None: PNG_SIGNATURE + b"\x00" * 16,
        )

        def failing_encode(*args, **kwargs):
            raise OSError("cannot read the rendered diagram")

        monkeypatch.setattr("md2docx.base64.b64encode", failing_encode)

        before = _mermaid_temp_dirs()
        with pytest.raises(Exception):
            preprocess_mermaid(
                "```mermaid\ngraph TD; A-->B\n```", enabled=True, api_url=None
            )

        leaked = _mermaid_temp_dirs() - before
        for path in leaked:
            import shutil

            shutil.rmtree(path, ignore_errors=True)

        assert leaked == set(), f"the temporary directory was left behind: {leaked}"


class TestPandocTimeout:
    def test_pandoc_gets_the_arguments_the_plugin_needs(self, monkeypatch):
        """The sandbox and the reference template have to reach the binary."""
        import shutil

        import md2docx

        reference = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        seen = {}

        class Result:
            returncode = 0
            stderr = b""

        def fake_run(args, **kwargs):
            seen["args"] = list(args)
            seen["kwargs"] = kwargs
            output = next(a for a in args if a.startswith("--output=")).split("=", 1)[1]
            shutil.copyfile(reference, output)
            return Result()

        monkeypatch.setattr("md2docx.subprocess.run", fake_run)

        md2docx.convert_via_pandoc(
            "# Doc", reference, os.path.dirname(reference), "",
            {"title": "A Title"},
        )

        args = seen["args"]
        assert "--sandbox" in args, f"the sandbox has to reach pandoc: {args}"
        assert "--reference-doc" in args, f"the reference has to reach pandoc: {args}"
        assert reference in args, f"the reference path has to reach pandoc: {args}"
        assert any(a.startswith("--output=") for a in args), f"the output has to reach pandoc: {args}"
        assert "--metadata" in args, f"the metadata has to reach pandoc: {args}"
        assert "title=A Title" in args, f"the metadata value has to reach pandoc: {args}"
        assert seen["kwargs"]["timeout"] == md2docx.PANDOC_TIMEOUT_SECONDS
        assert seen["kwargs"]["input"] == "# Doc".encode("utf-8")

    def test_a_hanging_pandoc_is_stopped(self, monkeypatch):
        """Pandoc must not hold the plugin worker for the whole daemon timeout."""
        from md2docx import convert_via_pandoc

        def fake_run(args, **kwargs):
            raise subprocess.TimeoutExpired(
                cmd=args, timeout=kwargs.get("timeout")
            )

        monkeypatch.setattr("md2docx.subprocess.run", fake_run)

        reference = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        with pytest.raises(RuntimeError) as excinfo:
            convert_via_pandoc(
                "# Title\n", reference, os.path.dirname(reference), "", {}
            )

        assert "second" in str(excinfo.value).lower()

    def test_pandoc_runs_with_a_time_limit(self, monkeypatch):
        from md2docx import PANDOC_TIMEOUT_SECONDS, convert_via_pandoc

        seen = {}

        def fake_run(args, **kwargs):
            seen["timeout"] = kwargs.get("timeout")
            raise subprocess.TimeoutExpired(cmd=args, timeout=kwargs.get("timeout"))

        monkeypatch.setattr("md2docx.subprocess.run", fake_run)

        reference = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        with pytest.raises(RuntimeError):
            convert_via_pandoc(
                "# Title\n", reference, os.path.dirname(reference), "", {}
            )

        assert seen["timeout"] == PANDOC_TIMEOUT_SECONDS


class TestBooleanParameters:
    def test_a_null_value_keeps_the_default(self):
        from md2docx import _coerce_bool

        assert _coerce_bool(None, default=True) is True
        assert _coerce_bool(None) is False

    def test_the_usual_spellings_still_work(self):
        from md2docx import _coerce_bool

        for value in ("false", "0", "no", "off", "disabled", "n", ""):
            assert _coerce_bool(value, default=True) is False

        assert _coerce_bool("true", default=False) is True
        assert _coerce_bool(True, default=False) is True


class TestFontInput:
    def test_a_non_string_font_is_ignored(self):
        from md2docx import build_pandoc_metadata

        metadata = build_pandoc_metadata("technical", 42, None, None)
        assert metadata["mainfont"] == "Arial"

    def test_a_font_with_control_characters_is_ignored(self):
        """A control character makes the XML writer refuse the whole document."""
        from md2docx import build_pandoc_metadata

        metadata = build_pandoc_metadata("technical", "Arial\x00", None, None)
        assert metadata["mainfont"] == "Arial"

    def test_the_style_layer_ignores_a_broken_font(self):
        from docx import Document

        from md2docx import apply_style_overrides

        reference = os.path.join(TEMPLATE_DIR, "reference_english_academic.docx")
        doc = Document(reference)

        apply_style_overrides(doc, "academic", {"body_font": "Arial\x00"})

        normal = doc.styles["Normal"]
        assert normal.font.name != "Arial\x00"


class TestErrorMessages:
    def test_a_pandoc_failure_does_not_leak_the_stack_trace(self):
        from md2docx import _map_pandoc_error

        message = _map_pandoc_error(
            'Pandoc died with exitcode "1" during conversion: pandoc: '
            "Data.Binary.Get.runGet at position 4: Did not find end of central "
            "directory signature / CallStack (from HasCallStack): error, called at "
            "libraries\\binary\\src\\Data\\Binary\\Get.hs:345:5"
        )

        assert "CallStack" not in message
        assert "Data.Binary" not in message
        assert "Get.hs" not in message

    def test_the_actionable_messages_stay(self):
        from md2docx import _map_pandoc_error

        assert "Word" in _map_pandoc_error("Permission denied")
        assert "image" in _map_pandoc_error("Could not fetch resource")


class TestCodeStyles:
    """Every profile that declares a code style applies it.

    The VS Code extension writes the code styles for academic, business,
    technical, official and thesis. The Dify plugin used to do it for the
    technical profile only, and it hardcoded the values instead of reading
    them from the preset table — so a change to the preset never reached
    this side.
    """

    @pytest.mark.parametrize(
        "profile,reference",
        [
            ("academic", "reference_english_academic.docx"),
            ("business", "reference_english_business.docx"),
            ("technical", "reference_english_technical.docx"),
            ("official", "reference_english_official.docx"),
            ("thesis", "reference_english_thesis.docx"),
        ],
    )
    def test_the_code_style_is_applied(self, profile, reference):
        from docx import Document
        from docx.oxml.ns import qn

        from md2docx import CODE_STYLE_NAMES, apply_style_overrides

        path = os.path.join(TEMPLATE_DIR, reference)
        doc = Document(path)

        style = next(s for s in doc.styles if s.name in CODE_STYLE_NAMES)
        # Take the font away, so that only the override can put it back.
        rPr = style.element.get_or_add_rPr()
        fonts = rPr.find(qn("w:rFonts"))
        if fonts is not None:
            rPr.remove(fonts)

        apply_style_overrides(doc, profile, {})

        assert style.font.name == "Consolas", f"the {profile} profile has to set the code style font"

    def test_the_code_style_comes_from_the_preset_table(self):
        from md2docx import PROFILE_DEFAULTS

        for profile in ("academic", "business", "technical", "official", "thesis"):
            code_style = PROFILE_DEFAULTS[profile].get("code_style")
            assert code_style, f"the {profile} profile has to declare its code style"
            assert code_style["font"] == "Consolas"
            assert code_style["size_pt"] == 10

        assert "shading_fill" not in PROFILE_DEFAULTS["academic"]["code_style"]
        assert PROFILE_DEFAULTS["technical"]["code_style"]["shading_fill"] == "F3F4F6"
        assert PROFILE_DEFAULTS["thesis"]["code_style"]["shading_fill"] == "F3F4F6"
