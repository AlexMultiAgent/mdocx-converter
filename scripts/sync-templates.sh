#!/usr/bin/env bash
# sync-templates.sh — Copy reference.docx templates from VSC plugin (source of truth)
# to Dify plugin directory. Run from repo root.
#
# Usage:
#   bash scripts/sync-templates.sh          # VSC → Dify (default)
#   bash scripts/sync-templates.sh --check  # dry-run: report mismatches only
#
# Template files (8 total):
#   reference_{english,chinese}_{academic,technical,business,government}.docx
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VSC_TEMPLATES="$REPO_ROOT/VSC-plugin-MD2Docx-Converter/multi-templates"
DIFY_TEMPLATES="$REPO_ROOT/dify-plugin-MD2Docx/multi-templates"
CHECK_ONLY=false

if [[ "${1:-}" == "--check" ]]; then
    CHECK_ONLY=true
fi

if [[ ! -d "$VSC_TEMPLATES" ]]; then
    echo "ERROR: VSC templates directory not found: $VSC_TEMPLATES"
    echo "Is the VSC plugin checked out? This script expects the full monorepo."
    exit 1
fi

mkdir -p "$DIFY_TEMPLATES"

TEMPLATES=(
    "reference_english_academic.docx"
    "reference_english_technical.docx"
    "reference_english_business.docx"
    "reference_english_government.docx"
    "reference_chinese_academic.docx"
    "reference_chinese_technical.docx"
    "reference_chinese_business.docx"
    "reference_chinese_government.docx"
)

MISMATCHES=0
COPIED=0

for tmpl in "${TEMPLATES[@]}"; do
    src="$VSC_TEMPLATES/$tmpl"
    dst="$DIFY_TEMPLATES/$tmpl"

    if [[ ! -f "$src" ]]; then
        echo "WARN: Source template missing (may be Dify-only): $tmpl"
        continue
    fi

    if $CHECK_ONLY; then
        if [[ ! -f "$dst" ]]; then
            echo "MISSING in Dify: $tmpl"
            MISMATCHES=$((MISMATCHES + 1))
        elif ! diff -q "$src" "$dst" > /dev/null 2>&1; then
            src_hash=$(sha256sum "$src" | cut -d' ' -f1)
            dst_hash=$(sha256sum "$dst" | cut -d' ' -f1)
            echo "MISMATCH: $tmpl (VSC=$src_hash Dify=$dst_hash)"
            MISMATCHES=$((MISMATCHES + 1))
        fi
    else
        if [[ ! -f "$dst" ]] || ! diff -q "$src" "$dst" > /dev/null 2>&1; then
            cp "$src" "$dst"
            echo "COPY: $tmpl → Dify"
            COPIED=$((COPIED + 1))
        fi
    fi
done

if $CHECK_ONLY; then
    if [[ $MISMATCHES -eq 0 ]]; then
        echo "OK: All $(( ${#TEMPLATES[@]} )) templates in sync."
    else
        echo "ERROR: $MISMATCHES template(s) out of sync. Run without --check to sync."
        exit 1
    fi
else
    if [[ $COPIED -eq 0 ]]; then
        echo "OK: All templates already in sync (nothing copied)."
    else
        echo "DONE: $COPIED template(s) copied. Remember to commit both subdirectories."
    fi
fi
