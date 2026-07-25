#!/bin/sh

# Downloads the pinned tokitoki-cli release for every platform into bin/,
# verifying each SHA-256 against the reviewed pins. CI and release builds use
# this; local development can cross-compile from source instead with
# `npm run build:agent`.

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

. "$SCRIPT_DIR/cli-release-pins.sh"

OUT_DIR="$PROJECT_DIR/bin"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tokitoki-cli-release.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

if ! printf '%s\n' "$TOKITOKI_CLI_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "error: invalid pinned CLI tag: $TOKITOKI_CLI_TAG" >&2
  exit 1
fi

BASE_URL="https://github.com/tokitoki-dev/tokitoki-cli/releases/download/$TOKITOKI_CLI_TAG"

sha256_check() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s  %s\n' "$2" "$1" | shasum -a 256 -c -
  else
    printf '%s  %s\n' "$2" "$1" | sha256sum -c -
  fi
}

fetch_and_verify() {
  asset="$1"
  expected_sha256="$2"
  destination="$TMP/$asset"

  if ! printf '%s\n' "$expected_sha256" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "error: invalid pinned CLI SHA-256 for $asset" >&2
    exit 1
  fi

  curl --fail --location --silent --show-error --retry 3 \
    --proto '=https' --proto-redir '=https' \
    --output "$destination" "$BASE_URL/$asset"

  sha256_check "$destination" "$expected_sha256"
  chmod 755 "$destination"
}

fetch_and_verify tokitoki-darwin-amd64 "$TOKITOKI_CLI_DARWIN_AMD64_SHA256"
fetch_and_verify tokitoki-darwin-arm64 "$TOKITOKI_CLI_DARWIN_ARM64_SHA256"
fetch_and_verify tokitoki-linux-amd64 "$TOKITOKI_CLI_LINUX_AMD64_SHA256"
fetch_and_verify tokitoki-linux-arm64 "$TOKITOKI_CLI_LINUX_ARM64_SHA256"
fetch_and_verify tokitoki-windows-amd64.exe "$TOKITOKI_CLI_WINDOWS_AMD64_SHA256"
fetch_and_verify tokitoki-windows-arm64.exe "$TOKITOKI_CLI_WINDOWS_ARM64_SHA256"

# Run the host-native asset as a second, independent check that the release
# behind the pinned tag reports the version the extension expects to bundle.
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) native="$TMP/tokitoki-darwin-arm64" ;;
  Darwin-x86_64) native="$TMP/tokitoki-darwin-amd64" ;;
  Linux-x86_64) native="$TMP/tokitoki-linux-amd64" ;;
  Linux-aarch64 | Linux-arm64) native="$TMP/tokitoki-linux-arm64" ;;
  *)
    echo "error: unsupported build host: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

got_version="$("$native" version)"
expected_version="${TOKITOKI_CLI_TAG#v}"
if [ "$got_version" != "$expected_version" ]; then
  echo "error: CLI reports '$got_version', pinned tag is '$expected_version'" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
mv "$TMP"/tokitoki-* "$OUT_DIR/"

echo "Fetched Tokitoki CLI $expected_version for all bundled platforms."
