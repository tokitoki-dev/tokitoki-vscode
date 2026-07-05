# TokiToki VS Code

VS Code integration for the local TokiToki usage sync agent.

This extension shells out to a bundled `tokitoki` CLI built from
`tracklm-goagent`. The runtime path is fixed:

```text
${extensionPath}/bin/tokitoki-${platform}-${arch}
```

The extension does not search workspace folders or `PATH` at runtime. Packaging
runs `npm run build:agent`, which cross-compiles the CLI into `bin/`.

## Commands

- `TokiToki: Sync Now` runs `tokitoki` once.
- `TokiToki: Set API Key` runs `tokitoki set key <API_KEY>`.
- `TokiToki: Show API Key Status` runs `tokitoki get key` and displays a masked key.
- `TokiToki: Install/Start/Stop/Restart/Show Background Service` maps to
  `tokitoki service ...`.
- `TokiToki: Open Output Log` opens the extension output channel.

The status bar item runs `TokiToki: Sync Now` when clicked.

## Settings

- `tokitoki.enabled`: enable or disable the extension integration.
- `tokitoki.autoSync`: run on startup and on an interval.
- `tokitoki.syncOnSave`: run a throttled sync after document saves.
- `tokitoki.syncIntervalMinutes`: automatic sync interval.
- `tokitoki.providerDirs`: optional repeated `provider=path` values passed as
  `--provider-dir`. Empty uses CLI defaults.
- `tokitoki.baseUrl`: value for `TOKITOKI_BASE_URL`.
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

The VSIX is emitted as `tokitoki-vscode-0.1.0.vsix`.
