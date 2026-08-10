# Development

The extension watches editor activity and reports activity heartbeats
through the `tokitoki` CLI, which owns the API key, the offline queue, and the
upload. It also runs a periodic AI usage scan over the CLI's default provider
directories, mirroring the macOS menu bar app.

```text
editor events -> throttler -> tokitoki heartbeat --entity FILE ...
                                   |
                     local queue (~/.tokitoki) -> Tokitoki server
```

- Selection changes, edits, tab switches, saves, debug and task events feed a
  50ms debounce, then a throttler: one heartbeat per file every 2 minutes,
  with writes and file/category switches passing immediately. The same rule
  every Tokitoki editor plugin uses.
- The CLI detects language and applies `.tokitoki` project files centrally,
  and queues events locally when offline.

## The shared CLI

Every Tokitoki client on a machine invokes one shared CLI:

```text
~/.tokitoki/bin/tokitoki                    macOS, Linux
%USERPROFILE%\.tokitoki\bin\tokitoki.exe    Windows
```

The extension resolves the shared binary first and falls back to its bundled
copy (`${extensionPath}/bin/tokitoki-${platform}-${arch}`). On activation it
seeds the shared location when the shared binary is missing or reports an
older release version — staged and renamed into place, never a downgrade —
then asks the CLI to update itself at most once a day.

## Build and Package

```sh
npm install
make              # build and install into local VS Code (default)
make build        # platform VSIX for this machine only
make clean        # remove everything generated
npm test          # compile and run unit tests
```

Every local build compiles the CLI from `../tokitoki-cli` source — never the
pinned release. The pinned-release CLI (`scripts/fetch-cli-release.sh`) is
used only by CI and the release workflow.

Every VSIX is platform-specific (`vsce --target`): it bundles exactly the
one CLI binary its platform needs, and the Marketplace serves each user the
matching package. `.build/cli/` holds all six binaries; `bin/` is the
per-target staging area.

The server URL is baked in at compile time by
`scripts/generate-server-url.js`. The Makefile always bakes the local dev
server (`http://localhost:9093`); production URLs only come out of CI, where
the variable is unset. There is no runtime override: the extension passes the
baked-in URL to every CLI invocation, so neither a setting nor the inherited
environment can redirect where API keys and usage data go.

CI and releases bundle the CLI release pinned in
`scripts/cli-release-pins.sh`; releases are cut by pushing a `vX.Y.Z` tag on
`main`, which must match `package.json`. `main` only accepts merges from
`dev` (`scripts/setup-branch-protection.sh` codifies the protection). The
release workflow publishes the VSIX to:
- GitHub Releases
- VS Code Marketplace (when `VSCE_PAT` secret is configured)
- Open VSX (when `OVSX_PAT` secret is configured)

See `RELEASE.md` for complete release procedures.
