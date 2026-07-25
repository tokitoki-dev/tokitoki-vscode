# TokiToki — Coding Time & AI Usage Analytics

**Know where your time and your AI spend actually go.**

TokiToki automatically tracks your coding activity in VS Code and syncs your
local AI agent usage — Claude Code, Codex, Copilot, Gemini, and a dozen more —
into one dashboard at [tokitoki.dev](https://tokitoki.dev).

## Features

- **Automatic time tracking** — just code. TokiToki records which files,
  projects, and languages you work in, including debugging and build time.
  No timers to start, no forms to fill.
- **AI usage analytics** — your local AI coding agents (Claude Code, Codex,
  Copilot CLI, Gemini, Amp, Goose, OpenCode, and more) are scanned and synced
  automatically, so tokens, models, and costs show up next to your coding
  time.
- **One dashboard for everything** — daily timelines, per-project totals,
  language breakdowns, and AI cost tracking across every editor and machine
  you use.
- **Works offline** — activity is queued locally and uploaded when you are
  back online. Nothing is lost on a plane.
- **Open source** — the extension and its CLI are open source, and the same
  tracking works in JetBrains IDEs, Eclipse, and the macOS menu bar app.

## Quick Start

1. Install the extension.
2. Run **TokiToki: Set API Key** from the command palette and paste the key
   from [tokitoki.dev](https://tokitoki.dev) — the extension will also prompt
   you on first use.
3. That's it. Click the status bar clock anytime to open your dashboard,
   already signed in.

## Commands

| Command | What it does |
| --- | --- |
| `TokiToki: Open Dashboard` | Opens your web dashboard, signed in |
| `TokiToki: Set API Key` | Stores your API key for every TokiToki client |
| `TokiToki: Show API Key Status` | Shows the configured key, masked |
| `TokiToki: Sync AI Usage Now` | Runs one AI usage scan immediately |
| `TokiToki: Open Output Log` | Opens the extension log |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `tokitoki.enabled` | `true` | Enable tracking and AI usage sync |
| `tokitoki.autoSync` | `true` | Scan AI usage on startup and every 30 minutes |
| `tokitoki.statusBar.enabled` | `true` | Show the status bar item |
| `tokitoki.showNotifications` | `true` | Notify on failures and manual commands |
| `tokitoki.baseUrl` | _(empty)_ | Self-hosted / staging server override |
| `tokitoki.logLevel` | `info` | Output channel verbosity |

To pin a stable project name across machines and editors, put a `.tokitoki`
file in the project root — the first line is the project name, an optional
second line overrides the branch.

## Privacy

TokiToki records activity metadata only: file paths, project and branch
names, language, timestamps, and cursor position — **never your code**. AI
usage sync reads token counts and model names from your local agent data.
Everything is queued in `~/.tokitoki` and uploaded over HTTPS with your API
key; delete your data anytime from the dashboard.

## Links

- [Dashboard](https://tokitoki.dev)
- [Source & issues](https://github.com/tokitoki-dev/tokitoki-vscode)
- [Contributing / development docs](https://github.com/tokitoki-dev/tokitoki-vscode/blob/main/DEVELOPMENT.md)
