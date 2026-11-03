#!/bin/sh
# Rebuilds fonts, app icons and placeholder photos from the text-encoded backup in
# .backup/binary-assets (used when the repo was pushed through an API that only carries text).
# Usage: sh scripts/restore-binary-assets.sh
set -e
cd "$(dirname "$0")/.."
cat .backup/binary-assets/part-*.b64 | base64 -d | tar xzf -
sha256sum -c --quiet .backup/binary-assets/SHA256SUMS && echo "Binary assets restored and verified."
