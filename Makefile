# Local development. Everything here builds the CLI from ../tokitoki-cli
# source and bakes in the local dev server — production builds are a CI
# concern (scripts/fetch-cli-release.sh, used by ci.yml and release.yml,
# never by this file), so a locally built VSIX can never talk to production.
#
#   make            Build and install into local VS Code (default)
#   make build      Build the VSIX for this machine
#   make clean      Remove everything generated

export TOKITOKI_BASE_URL := http://localhost:9093

VERSION := $(shell node -p "require('./package.json').version")

UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)
ifeq ($(UNAME_S),Darwin)
  ifeq ($(UNAME_M),arm64)
    HOST_TARGET := darwin-arm64
  else
    HOST_TARGET := darwin-x64
  endif
else
  ifeq ($(UNAME_M),aarch64)
    HOST_TARGET := linux-arm64
  else
    HOST_TARGET := linux-x64
  endif
endif

VSIX := tokitoki-vscode-$(HOST_TARGET)-$(VERSION).vsix

.DEFAULT_GOAL := install
.PHONY: build install clean

# The CLI is always rebuilt from source: the point is to pick up edits, and a
# cache check would silently ship the previous build. Binaries are stamped
# "dev" unless ../tokitoki-cli HEAD sits on an exact vX.Y.Z tag, and a "dev"
# CLI declines to self-update — see scripts/build-agent-binaries.js.
build:
	@echo "==> Server: $(TOKITOKI_BASE_URL)"
	rm -rf .build/cli
	node scripts/build-agent-binaries.js $(HOST_TARGET)
	scripts/stage-cli.sh $(HOST_TARGET)
	npx vsce package --no-dependencies --allow-missing-repository \
	  --target $(HOST_TARGET) -o $(VSIX)

install: build
	code --install-extension $(VSIX) --force

clean:
	rm -rf out bin .build *.vsix src/serverUrl.ts
