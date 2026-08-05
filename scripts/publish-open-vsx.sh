#!/bin/bash
# Publish all platform VSIXes to Open VSX
# Usage: OVSX_PAT=your_token ./scripts/publish-open-vsx.sh

set -eu

OVSX_PAT="${OVSX_PAT:?Please set OVSX_PAT environment variable}"
VERSION=$(node -p "require('./package.json').version")

echo "Publishing Tokitoki v$VERSION to Open VSX..."
echo ""

# Each platform is a separate publish. One rejection must not abandon the
# rest, so failures are collected and reported in the exit status.
failed=0
for target in darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64 win32-arm64; do
  vsix="tokitoki-vscode-$target-$VERSION.vsix"
  if [ ! -f "$vsix" ]; then
    echo "⚠ Missing $vsix (skipped)"
    failed=1
    continue
  fi
  echo "→ Publishing $vsix..."
  npx --yes ovsx publish "$vsix" -p "$OVSX_PAT" || failed=1
done

echo ""
if [ "$failed" -ne 0 ]; then
  echo "❌ Some VSIXes did not publish. See the errors above." >&2
  exit 1
fi
echo "✅ Published to Open VSX!"
