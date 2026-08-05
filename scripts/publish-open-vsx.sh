#!/bin/bash
# Publish all platform VSIXes to Open VSX
# Usage: OVSX_PAT=your_token ./scripts/publish-open-vsx.sh

set -eu

OVSX_PAT="${OVSX_PAT:?Please set OVSX_PAT environment variable}"
VERSION=$(node -p "require('./package.json').version")

# Ensure ovsx CLI is installed
command -v ovsx >/dev/null 2>&1 || npm install -g ovsx

echo "Publishing Tokitoki v$VERSION to Open VSX..."
echo ""

# Publish each platform VSIX
for target in darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64 win32-arm64; do
  vsix="tokitoki-vscode-$target-$VERSION.vsix"
  if [ -f "$vsix" ]; then
    echo "→ Publishing $vsix..."
    ovsx publish "$vsix" -p "$OVSX_PAT"
  else
    echo "⚠ Missing $vsix (skipped)"
  fi
done

echo ""
echo "✅ Published to Open VSX!"
