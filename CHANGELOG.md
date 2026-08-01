# Changelog

## Unreleased

- New command **Tokitoki: Set Project Name** writes the project's
  `.tokitoki` file, so a folder reports the same name from every editor
  and machine. It opens on the name in use today — the folder name until
  you pin one — and leaves an existing branch override untouched.

## 0.1.4

- Settings that did nothing for you are gone: `tokitoki.autoSync`,
  `tokitoki.baseUrl`, `tokitoki.showNotifications`,
  `tokitoki.commandTimeoutSeconds`, and `tokitoki.logLevel`. Syncing is
  always on and the server URL is baked in at build time.
- Clearer message when no API key is set, instead of a generic CLI
  failure.
- Bundled CLI updated to v0.1.5.

## 0.1.3

- The status bar shows the Tokitoki logo instead of generic codicons,
  and it spins while an AI usage sync is running.
- Errors no longer turn the status bar red: events queue locally and
  upload once the network is back, so failures stay in the tooltip and
  the log.
- Saving an API key now starts a sync immediately; it no longer waited
  on the "API key saved" notification being dismissed.
- A key configured outside VS Code (macOS app, `tokitoki set key`) is
  picked up as soon as the window regains focus, instead of after a
  restart or the next timer tick.
- Bundled CLI updated to v0.1.4.

## 0.1.2

- Tracking is always on; the Toggle Tracking command and the
  `tokitoki.enabled` setting are gone. Use VS Code's own extension
  Disable button to turn Tokitoki off.

## 0.1.1

- Command palette entries no longer repeat the Tokitoki prefix.
- A missing API key opens the input box right after activation; a
  configured key stays silent.
- `Tokitoki: Set API Key` pre-fills the configured key, masked, so you can
  see one exists before replacing it.
- Automatic AI usage syncs stay silent until an API key is configured.
- `Show API Key Status` now verifies the key against the server through
  the CLI: valid, or rejected with a shortcut to set a new key.
- Platform-specific packages: each VSIX bundles only its own platform's
  CLI binary, cutting the download from 28 MB to about 5 MB.
- The command palette keeps four commands: Set API Key, Open Dashboard,
  Show API Key Status, and a new Toggle Tracking. Manual sync and the
  log command are gone — syncs are automatic and the log stays
  reachable from error notifications and the Output panel.

## 0.1.0

First release.

- Coding time tracking: heartbeats from editor activity
  (typing, file switches, saves, debugging, builds) through
  `tokitoki heartbeat`, throttled to one per two minutes per file.
- AI usage sync on startup and every 30 minutes over the CLI's default
  provider directories.
- Shared CLI contract: resolve `~/.tokitoki/bin/tokitoki` first, seed it from
  the bundled copy when missing or older, and run `tokitoki update` daily.
- `Tokitoki: Open Dashboard` command with signed-in dashboard URLs.
- Prompt to set the API key when heartbeats report it missing.
