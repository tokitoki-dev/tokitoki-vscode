#!/bin/sh

# Puts exactly one CLI binary into bin/ for a platform-specific VSIX.
# Usage: scripts/stage-cli.sh <vsce-target>   e.g. darwin-arm64, win32-x64

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

case "${1:?usage: stage-cli.sh <vsce-target>}" in
  darwin-x64)   asset=tokitoki-darwin-amd64 ;;
  darwin-arm64) asset=tokitoki-darwin-arm64 ;;
  linux-x64)    asset=tokitoki-linux-amd64 ;;
  linux-arm64)  asset=tokitoki-linux-arm64 ;;
  win32-x64)    asset=tokitoki-windows-amd64.exe ;;
  win32-arm64)  asset=tokitoki-windows-arm64.exe ;;
  *) echo "error: unsupported target: $1" >&2; exit 1 ;;
esac

source="$PROJECT_DIR/.build/cli/$asset"
if [ ! -e "$source" ]; then
  echo "error: $source is missing; run npm run fetch:agent first" >&2
  exit 1
fi

rm -rf "$PROJECT_DIR/bin"
mkdir -p "$PROJECT_DIR/bin"
cp "$source" "$PROJECT_DIR/bin/$asset"
echo "Staged $asset for $1"
