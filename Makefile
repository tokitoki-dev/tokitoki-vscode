# Common tasks. `make` packages the VSIX for production.
# Test-server package:  TOKITOKI_BASE_URL=http://localhost:9093 make
# Install into VS Code: make install

.PHONY: package install test check fetch-cli build-cli clean

package:
	@ls bin/tokitoki-* >/dev/null 2>&1 || npm run fetch:agent
	npm run package

install: package
	code --install-extension "$$(ls -t tokitoki-vscode-*.vsix | head -1)" --force

test:
	npm test

check:
	npm run check

# Download the pinned CLI release into bin/ (what CI and releases bundle)
fetch-cli:
	npm run fetch:agent

# Cross-compile the CLI from ../tokitoki-cli source (development)
build-cli:
	npm run build:agent

clean:
	rm -rf out *.vsix src/serverUrl.ts
