# Changelog

## 0.1.1

- Command palette entries no longer repeat the TokiToki prefix.
- A missing API key opens the input box right after activation; a
  configured key stays silent.
- `TokiToki: Set API Key` pre-fills the configured key, masked, so you can
  see one exists before replacing it.
- Automatic AI usage syncs stay silent until an API key is configured.

## 0.1.0

First release.

- Coding time tracking: WakaTime-style heartbeats from editor activity
  (typing, file switches, saves, debugging, builds) through
  `tokitoki heartbeat`, throttled to one per two minutes per file.
- AI usage sync on startup and every 30 minutes over the CLI's default
  provider directories.
- Shared CLI contract: resolve `~/.tokitoki/bin/tokitoki` first, seed it from
  the bundled copy when missing or older, and run `tokitoki update` daily.
- `TokiToki: Open Dashboard` command with signed-in dashboard URLs.
- Prompt to set the API key when heartbeats report it missing.
