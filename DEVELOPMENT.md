# Development

The extension watches editor activity and reports activity heartbeats
through the `tokitoki` CLI, which owns the API key, the offline queue, and the
upload. It also runs a periodic AI usage scan over the CLI's default provider
directories, mirroring the macOS menu bar app.

```text
editor events -> throttler -> tokitoki heartbeat --entity FILE ...
                                   |
                     local queue (~/.tokitoki) -> TokiToki server
```

- Selection changes, edits, tab switches, saves, debug and task events feed a
  50ms debounce, then a throttler: one heartbeat per file every 2 minutes,
  with writes and file/category switches passing immediately. The same rule
  every TokiToki editor plugin uses.
- The CLI detects language and applies `.tokitoki` project files centrally,
  and queues events locally when offline.

## The shared CLI

Every TokiToki client on a machine invokes one shared CLI:

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
npm run fetch:agent   # pinned CLI release (what CI bundles), or:
npm run build:agent   # cross-compile from ../tokitoki-cli source
npm run check
npm test
npm run package
```

CI and releases bundle the CLI release pinned in
`scripts/cli-release-pins.sh`; releases are cut by pushing a `vX.Y.Z` tag on
`main`, which must match `package.json`. `main` only accepts merges from
`dev` (`scripts/setup-branch-protection.sh` codifies the protection). The
release workflow publishes the VSIX to a GitHub release and, when the
`VSCE_PAT` repository secret is configured, to the VS Code Marketplace.
