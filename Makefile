# Common tasks. `make` packages a VSIX for this machine's platform.
# Production:        make install
# Local test server: make install-dev
# All six platforms: make package-all
# Any other server:  TOKITOKI_BASE_URL=https://staging.example.com make
#
# The packaging targets bundle the *pinned release* CLI (fetch-cli downloads
# it). To bundle the CLI you are editing in ../tokitoki-cli instead, use the
# -src variants: make install-src / make package-src.

DEV_SERVER := http://localhost:9093

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

.PHONY: package package-all package-dev package-src install install-dev install-src \
        test check fetch-cli build-cli clean

# Test-server builds: same targets, server baked in from DEV_SERVER
package-dev:
	TOKITOKI_BASE_URL=$(DEV_SERVER) $(MAKE) package

install-dev:
	TOKITOKI_BASE_URL=$(DEV_SERVER) $(MAKE) install

# Which target puts binaries in .build/cli/. The -src variants override it to
# build-cli so the whole packaging chain reuses one recipe per platform.
CLI_SOURCE ?= fetch-cli

package: $(CLI_SOURCE)
	@echo "==> Packaging for server: $${TOKITOKI_BASE_URL:-https://tokitoki.dev (production)}"
	scripts/stage-cli.sh $(HOST_TARGET)
	npx vsce package --no-dependencies --allow-missing-repository \
	  --target $(HOST_TARGET) -o tokitoki-vscode-$(HOST_TARGET)-$(VERSION).vsix

package-all: $(CLI_SOURCE)
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

# Package/install a VSIX carrying the CLI built from ../tokitoki-cli source
# rather than the pinned release. Recursing with CLI_SOURCE overridden keeps
# one packaging recipe: the only difference is what fills .build/cli/.
package-src:
	$(MAKE) package CLI_SOURCE=build-cli

install-src:
	$(MAKE) install CLI_SOURCE=build-cli

# Download the pinned CLI release into .build/cli/ (skips if already there)
fetch-cli:
	@ls .build/cli/tokitoki-* >/dev/null 2>&1 || npm run fetch:agent

# Cross-compile the CLI from ../tokitoki-cli source into .build/cli/ for all
# six platforms. Unlike fetch-cli this always rebuilds: the point is to pick up
# edits, and a cache check would silently ship the previous build. Binaries are
# stamped "dev" unless HEAD sits on an exact vX.Y.Z tag, and a "dev" CLI
# declines to self-update — see scripts/build-agent-binaries.js.
build-cli:
	rm -rf .build/cli
	npm run build:agent

clean:
	rm -rf out bin .build *.vsix src/serverUrl.ts
