# Common tasks. `make` packages a VSIX for this machine's platform.
# Test-server package:  TOKITOKI_BASE_URL=http://localhost:9093 make
# Install into VS Code: make install
# All six platforms:    make package-all

TARGETS := darwin-arm64 darwin-x64 linux-x64 linux-arm64 win32-x64 win32-arm64
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

.PHONY: package package-all install test check fetch-cli build-cli clean

package: fetch-cli
	@echo "==> Packaging for server: $${TOKITOKI_BASE_URL:-https://tokitoki.dev (production)}"
	scripts/stage-cli.sh $(HOST_TARGET)
	npx vsce package --no-dependencies --allow-missing-repository \
	  --target $(HOST_TARGET) -o tokitoki-vscode-$(HOST_TARGET)-$(VERSION).vsix

package-all: fetch-cli
	@echo "==> Packaging for server: $${TOKITOKI_BASE_URL:-https://tokitoki.dev (production)}"
	for t in $(TARGETS); do \
	  scripts/stage-cli.sh $$t && \
	  npx vsce package --no-dependencies --allow-missing-repository \
	    --target $$t -o tokitoki-vscode-$$t-$(VERSION).vsix || exit 1; \
	done

install: package
	code --install-extension tokitoki-vscode-$(HOST_TARGET)-$(VERSION).vsix --force

test:
	npm test

check:
	npm run check

# Download the pinned CLI release into .build/cli/ (skips if already there)
fetch-cli:
	@ls .build/cli/tokitoki-* >/dev/null 2>&1 || npm run fetch:agent

# Cross-compile the CLI from ../tokitoki-cli source (development)
build-cli:
	npm run build:agent

clean:
	rm -rf out bin .build *.vsix src/serverUrl.ts
