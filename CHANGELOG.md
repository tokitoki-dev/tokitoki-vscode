# Changelog

## 0.1.11

- Bundled CLI updated to v0.1.11: Claude Code and Codex **tool calls** —
  built-in tools, MCP tools and the programs a shell command runs — and
  **prompts** are recorded, so the dashboard shows which tools agents use
  and how long each question took. Tool arguments and prompt text never
  leave your machine. The first sync after updating reads existing
  transcripts once more to pick up their history.
- **Projects are named after their repository.** Heartbeats no longer send
  the folder name: the CLI names the project from the file and the
  workspace folder, the same way it names an AI agent's work, so editor
  time and AI usage land on one project, and a worktree or a subfolder
  counts toward its repository. A name pinned in `.tokitoki` still wins,
  and **Set Project Name** proposes the name in effect. The branch is read
  from the checkout itself.
- Debugging and building are read from VS Code when a heartbeat goes out:
  a debug session already running when the extension started counts, Run
  Without Debugging no longer counts as debugging, and only tasks in the
  Build group count as building — background watchers such as
  `tsc --watch` do not.

## 0.1.10

- Bundled CLI updated to v0.1.10: it keeps a rotating run log under
  `~/.tokitoki`, reports errors that will not fix themselves so they can be
  fixed on our side, and labels each machine by its hostname without the
  network suffix, so one computer no longer shows up as several. Set
  `TOKITOKI_HOSTNAME` to choose the label yourself.
- The Marketplace listing now says what the extension does: coding time
  tracking and AI usage for Claude Code, Codex, Copilot, Cursor and more.

## 0.1.9

- The status bar shows **today's active time for the project the window has
  open** — the account total in a window without a folder — and the tooltip
  lists both with today's tokens. The figure comes from the server, so every
  machine with the same key shows the same number; while offline it keeps
  the last one. `tokitoki.statusBar.showTime` turns the figure off and leaves
  the icon.
- **More activity counts.** Scrolling, switching tabs (including to an AI
  chat panel), returning to the window, using the terminal (open, switch,
  every command run), notebook edits, and creating, renaming or deleting
  files all keep the clock running. Time in a chat panel or the terminal is
  credited to the file you were last in.
- **Jupyter notebooks are tracked.** A cell's activity is credited to its
  `.ipynb` with the cell's language; previously notebooks recorded nothing.
- Heartbeats carry VS Code's own **language** — shebang scripts, files
  without an extension and custom associations no longer show as Unknown —
  and the **lines you typed** yourself, kept apart from what agents and
  completions wrote.
- Reviewing a diff is recorded as **code reviewing** rather than coding.
- Bundled CLI updated to v0.1.9.

## 0.1.8

- New **Usage Stats** view in the activity bar shows your stats without
  leaving the editor. Refresh it from the view title, and reach the
  dashboard, project name, and API key from its menu.
- The extension is now licensed under Apache 2.0, previously MIT.
- Japanese and Simplified Chinese translations cover the new view.
- Bundled CLI updated to v0.1.8.

## 0.1.7

- VS Code forks now report themselves by name. Cursor, Windsurf, and
  VSCodium sessions were all recorded as "vscode"; each one now shows up
  as itself on the dashboard.
- Releases publish to Open VSX alongside the VS Code Marketplace, so the
  extension is installable from editors that do not use the Microsoft
  registry.

## 0.1.5

- New command **Tokitoki: Set Project Name** writes the project's
  `.tokitoki` file, so a folder reports the same name from every editor
  and machine. It opens on the name in use today — the folder name until
  you pin one — and leaves an existing branch override untouched.
- Bundled CLI updated to v0.1.6.

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
