# Changelog

## 0.2.0

- Coding time tracking: heartbeats from editor activity
  (typing, file switches, saves, debugging, builds) through
  `tokitoki heartbeat`, throttled to one per two minutes per file.
- Shared CLI contract: resolve `~/.tokitoki/bin/tokitoki` first, seed it from
  the bundled copy when missing or older, and run `tokitoki update` daily.
- `TokiToki: Open Dashboard` command with signed-in dashboard URLs.
- Prompt to set the API key when heartbeats report it missing.
- Removed the background service commands and `syncOnSave`; heartbeats
  replace them. AI usage sync now defaults to every 30 minutes.
- `tokitoki.baseUrl` defaults to empty (the CLI's production default) instead
  of `http://localhost:9093`.

## 0.1.0

- Initial MVP for syncing with a local `tokitoki` CLI from VS Code.
