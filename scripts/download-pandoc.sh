#!/usr/bin/env bash
# download-pandoc.sh — Download pandoc binary for bundling into the Dify plugin.
# Run from repo root before packaging the plugin.
#
# The binary is placed at dify-plugin-MD2Docx/_assets/bin/pandoc.
# pypandoc will use it via the PYPANDOC_PANDOC env var set in src/md2docx.py.
set -euo pipefail

PANDOC_VERSION="3.1.11.1"
PANDOC_URL="https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz"
DEST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dify-plugin-MD2Docx/_assets/bin"
DEST_FILE="$DEST_DIR/pandoc"

if [[ -f "$DEST_FILE" ]]; then
    echo "pandoc ${PANDOC_VERSION} already downloaded at $DEST_FILE"
    exit 0
fi

mkdir -p "$DEST_DIR"
echo "Downloading pandoc ${PANDOC_VERSION} ..."
curl -sL "$PANDOC_URL" -o /tmp/pandoc-${PANDOC_VERSION}.tar.gz
echo "Extracting ..."
tar xzf /tmp/pandoc-${PANDOC_VERSION}.tar.gz -C /tmp
cp /tmp/pandoc-${PANDOC_VERSION}/bin/pandoc "$DEST_FILE"
rm -rf /tmp/pandoc-${PANDOC_VERSION} /tmp/pandoc-${PANDOC_VERSION}.tar.gz
echo "Done: $DEST_FILE ($(du -h "$DEST_FILE" | cut -f1))"

# Keep the binary out of git (too large for GitHub)
if ! grep -q "_assets/bin/pandoc" "$(dirname "$DEST_DIR")/.gitignore" 2>/dev/null; then
    echo "_assets/bin/pandoc" >> "$(dirname "$DEST_DIR")/.gitignore"
fi
