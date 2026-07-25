# TokiToki VS Code

Coding time tracking and local AI usage sync for TokiToki.

The extension watches editor activity and sends heartbeats
through the `tokitoki` CLI: one per two minutes per file, with file switches,
category changes, and saves passing immediately. The CLI queues events in the
shared local database, so offline work uploads later. It also scans local AI
client data (Claude Code, Codex, ...) on an interval, same as the macOS menu
bar app.

## The shared CLI

Every TokiToki client on a machine invokes one shared CLI:

```text
~/.tokitoki/bin/tokitoki            macOS, Linux
%USERPROFILE%\.tokitoki\bin\tokitoki.exe   Windows
```

The extension resolves the shared binary first and falls back to its bundled
copy (`${extensionPath}/bin/tokitoki-${platform}-${arch}`). On activation it
seeds the shared location when the shared binary is missing or reports an
older release version — staged and renamed into place, never a downgrade —
then asks the CLI to update itself at most once a day. Packaging runs
`npm run build:agent`, which cross-compiles the CLI from `tokitoki-cli`;
an exact release tag stamps the version, otherwise the build reports `dev`
and only ever fills an empty shared slot.

## Commands

- `TokiToki: Open Dashboard` opens the web dashboard, signed in when possible.
- `TokiToki: Sync AI Usage Now` runs one AI usage scan and upload.
- `TokiToki: Set API Key` runs `tokitoki set key <API_KEY>`.
- `TokiToki: Show API Key Status` displays a masked key.
- `TokiToki: Open Output Log` opens the extension output channel.

The status bar item opens the dashboard when clicked.

## Settings

- `tokitoki.enabled`: enable coding time tracking and AI usage sync.
- `tokitoki.autoSync`: scan AI usage on startup and every 30 minutes.
- `tokitoki.baseUrl`: server override for staging; empty uses the CLI default.
- `tokitoki.statusBar.enabled`: show the status bar item.
- `tokitoki.showNotifications`: notifications for failures and manual commands.
- `tokitoki.commandTimeoutSeconds`: timeout for one CLI command.
- `tokitoki.logLevel`: output channel verbosity.

## Build and Package

```sh
npm install
npm run build:agent
npm run check
npm test
npm run package
```
