import * as vscode from 'vscode';

import { ActivityTracker, TrackedHeartbeat } from './activityTracker';
import { ExtensionConfig, readConfig } from './config';
import { Logger } from './logger';
import { PROJECT_FILE_NAME, readProjectName, writeProjectName } from './projectFile';
import { TOKITOKI_BASE_URL } from './serverUrl';
import { maskApiKey, TokitokiCli, TokitokiCliError } from './tokitokiCli';

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_UPDATE_CHECK_KEY = 'tokitoki.lastUpdateCheckAt';
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

class TokitokiExtension implements vscode.Disposable {
  private config: ExtensionConfig = readConfig();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusBar: vscode.StatusBarItem;
  private readonly tracker: ActivityTracker;
  private syncTimer: NodeJS.Timeout | undefined;
  private syncRunning = false;
  private heartbeatChain: Promise<void> = Promise.resolve();
  private lastHeartbeatAt: Date | undefined;
  private lastSyncAt: Date | undefined;
  private promptedForApiKey = false;
  private apiKeyMissing = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      'tokitoki.status',
      vscode.StatusBarAlignment.Left,
      0,
    );
    this.statusBar.name = 'Tokitoki';
    this.statusBar.command = 'tokitoki.openDashboard';
    this.tracker = new ActivityTracker((heartbeat) => this.sendHeartbeat(heartbeat));

    this.disposables.push(
      this.statusBar,
      this.tracker,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('tokitoki')) {
          this.reloadConfig();
        }
      }),
      // The key lives in the CLI's shared store, so the macOS app or a
      // terminal `tokitoki set key` can configure it while this window sits
      // keyless. Refocusing the window is exactly when that user comes back —
      // recheck then instead of making them wait for the timer or a restart.
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused && this.apiKeyMissing) {
          void this.syncNow();
        }
      }),
    );
  }

  public async initialize(): Promise<void> {
    this.logger.info(`Tokitoki extension activated from ${this.context.extensionPath}`);
    this.logger.info(`Server: ${TOKITOKI_BASE_URL}`);
    this.reloadConfig();

    // Seed the shared CLI before the first invocation so everything binds to
    // the shared copy, then let the CLI update itself — silent, at most daily.
    try {
      await this.createCli().bootstrapSharedCli();
    } catch (error) {
      this.logger.warn(`Failed to seed shared CLI: ${error instanceof Error ? error.message : String(error)}`);
    }
    void this.promptForApiKeyIfMissing();

    // Tracking and uploading is the whole point of the extension: it starts
    // once here and runs for the session. Nothing turns it off short of
    // disabling the extension.
    this.tracker.start();
    this.syncTimer = setInterval(() => {
      void this.syncNow();
    }, SYNC_INTERVAL_MS);
    void this.syncNow();
    void this.updateSharedCliDaily();
  }

  /** On activation: a configured key stays silent, a missing one opens the
   * input box straight away. */
  private async promptForApiKeyIfMissing(): Promise<void> {
    try {
      await this.createCli().getApiKey();
    } catch {
      await this.promptForApiKeyOnce();
    }
  }

  /** One automatic AI usage sync. Silent while already running or missing a
   * key — the activation prompt already asks for one. Same rules as the
   * macOS app's automatic sync. */
  private async syncNow(): Promise<void> {
    if (this.syncRunning) {
      return;
    }
    // Claim the slot before the first await. Setting it after one would let
    // the timer tick and a window focus both pass the check and start two
    // concurrent syncs.
    this.syncRunning = true;
    try {
      try {
        await this.createCli().getApiKey();
        this.apiKeyMissing = false;
      } catch {
        this.apiKeyMissing = true;
        return;
      }

      this.updateStatus('$(tokitoki-logo~spin) Tokitoki', vscode.l10n.t('Tokitoki AI usage sync in progress'));
      this.logger.info('Starting AI usage sync');

      try {
        const result = await this.createCli().sync();
        this.logCommandOutput(result.stdout, result.stderr);
        this.lastSyncAt = new Date();
        this.updateReadyStatus();
      } catch (error) {
        await this.handleCommandError(error, vscode.l10n.t('Tokitoki sync failed.'), false);
      }
    } finally {
      this.syncRunning = false;
    }
  }

  public async setApiKey(): Promise<void> {
    // Pre-fill the configured key; password masking renders it as dots, so
    // the user sees that a key exists without the key itself being shown.
    let existing = '';
    try {
      existing = (await this.createCli().getApiKey()).stdout.trim();
    } catch {
      // No key configured yet.
    }
    const apiKey = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Tokitoki API key'),
      placeHolder: vscode.l10n.t('Paste your API key from tokitoki.dev'),
      value: existing,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('API key is required')),
    });
    if (!apiKey || apiKey.trim() === existing) {
      return;
    }

    try {
      const result = await this.createCli().setApiKey(apiKey.trim());
      this.logCommandOutput(result.stdout, result.stderr);
      this.updateReadyStatus();
      // Sync starts before the notification: an awaited no-button toast only
      // resolves when the user dismisses it, so anything after it may never
      // run. And a user who just set a key wants data flowing now rather than
      // at the next timer tick.
      void this.syncNow();
      await vscode.window.showInformationMessage(vscode.l10n.t('Tokitoki API key saved.'));
    } catch (error) {
      await this.handleCommandError(error, vscode.l10n.t('Unable to save Tokitoki API key.'), true);
    }
  }

  public async showApiKeyStatus(): Promise<void> {
    let masked: string;
    try {
      const result = await this.createCli().getApiKey();
      this.logCommandOutput('', result.stderr);
      masked = maskApiKey(result.stdout);
    } catch (error) {
      await this.handleCommandError(error, vscode.l10n.t('Tokitoki API key is not configured.'), true);
      return;
    }

    let valid: boolean;
    try {
      valid = await this.createCli().verifyApiKey();
    } catch (error) {
      await this.handleCommandError(error, vscode.l10n.t('Unable to verify the Tokitoki API key.'), true);
      return;
    }

    if (valid) {
      await vscode.window.showInformationMessage(vscode.l10n.t('Tokitoki API key is valid ({0}).', masked));
      return;
    }
    const setKey = vscode.l10n.t('Set API Key');
    const selected = await vscode.window.showWarningMessage(
      vscode.l10n.t('Tokitoki API key ({0}) was rejected by the server. Set a new one?', masked),
      setKey,
    );
    if (selected === setKey) {
      await this.setApiKey();
    }
  }

  /**
   * Pins the project name the CLI reports for a folder by writing the first
   * line of its `.tokitoki` file. Nothing to restart: every heartbeat resolves
   * that file from disk, so the next one already carries the new name.
   */
  public async setProjectName(): Promise<void> {
    const folder = await this.pickProjectFolder();
    if (!folder) {
      return;
    }

    // No file, or a blank first line, means the CLI is falling back to the
    // folder name — so that is what is in effect and what the box shows.
    const pinned = await readProjectName(folder.uri.fsPath);
    const name = await vscode.window.showInputBox({
      title: vscode.l10n.t('Tokitoki Project Name'),
      prompt: vscode.l10n.t('Recorded for this folder in {0}, shared with every Tokitoki client.', PROJECT_FILE_NAME),
      value: pinned || folder.name,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : vscode.l10n.t('Project name is required')),
    });
    if (name === undefined) {
      return;
    }
    const trimmed = name.trim();
    // Accepting the folder-name default still writes the file — that is how
    // the name survives a rename or a checkout under a different directory.
    if (!trimmed || trimmed === pinned) {
      return;
    }

    try {
      await writeProjectName(folder.uri.fsPath, trimmed);
    } catch (error) {
      const message = vscode.l10n.t('Unable to write the {0} file in {1}.', PROJECT_FILE_NAME, folder.name);
      this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
      const openLog = vscode.l10n.t('Open Log');
      if (await vscode.window.showErrorMessage(message, openLog) === openLog) {
        this.logger.show();
      }
      return;
    }
    this.logger.info(`Project name for ${folder.uri.fsPath} set to ${trimmed}`);
    await vscode.window.showInformationMessage(vscode.l10n.t('Tokitoki project name set to {0}.', trimmed));
  }

  /** The folder whose `.tokitoki` file gets written. A multi-root workspace
   * has to ask: guessing writes the name into the wrong project. */
  private async pickProjectFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      await vscode.window.showWarningMessage(
        vscode.l10n.t('Open a folder before setting a Tokitoki project name.'),
      );
      return undefined;
    }
    if (folders.length === 1) {
      return folders[0];
    }
    return vscode.window.showWorkspaceFolderPick({
      placeHolder: vscode.l10n.t('Select the folder to name'),
    });
  }

  public async openDashboard(): Promise<void> {
    // Signed-in when possible; anything that fails (no key, no network)
    // falls back to the plain server URL, which lands on the login page.
    try {
      const url = await this.createCli().dashboardUrl();
      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return;
      }
    } catch (error) {
      this.logger.debug(`Dashboard URL unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    await vscode.env.openExternal(vscode.Uri.parse(TOKITOKI_BASE_URL));
  }

  public dispose(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    // The logger outlives the disposables on purpose: a heartbeat still in
    // flight logs from its callback, and disposing the channel first would
    // write to a dead one. shutdown() closes it once the chain drains.
  }

  /**
   * Waits for the in-flight heartbeat to finish, then closes the log. Tracking
   * is already stopped by dispose(), so the chain is drained, never growing.
   */
  public async shutdown(): Promise<void> {
    this.dispose();
    try {
      await this.heartbeatChain;
    } finally {
      this.logger.dispose();
    }
  }

  private sendHeartbeat(heartbeat: TrackedHeartbeat): void {
    // Serialize sends so a slow upload never piles up parallel CLI processes;
    // the CLI queues events locally either way, so order is not correctness.
    this.heartbeatChain = this.heartbeatChain.then(async () => {
      try {
        await this.createCli().heartbeat({
          entity: heartbeat.entity,
          timeSeconds: heartbeat.timeSeconds,
          project: heartbeat.project,
          projectFolder: heartbeat.projectFolder,
          plugin: this.pluginUserAgent(),
          category: heartbeat.category,
          isWrite: heartbeat.isWrite,
          lineNumber: heartbeat.lineNumber,
          cursorPosition: heartbeat.cursorPosition,
          linesInFile: heartbeat.linesInFile,
        });
        this.lastHeartbeatAt = new Date();
        this.updateReadyStatus();
        this.logger.debug(`Heartbeat sent: ${heartbeat.entity} (${heartbeat.category})`);
      } catch (error) {
        if (error instanceof TokitokiCliError && error.isMissingApiKey) {
          this.apiKeyMissing = true;
          await this.promptForApiKeyOnce();
          return;
        }
        this.logger.warn(`Heartbeat failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private async promptForApiKeyOnce(): Promise<void> {
    if (this.promptedForApiKey) {
      return;
    }
    this.promptedForApiKey = true;
    this.updateStatus('$(tokitoki-logo) Tokitoki', vscode.l10n.t('Tokitoki API key is not configured'));
    await this.setApiKey();
  }

  private async updateSharedCliDaily(): Promise<void> {
    const lastCheck = this.context.globalState.get<number>(LAST_UPDATE_CHECK_KEY, 0);
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) {
      return;
    }
    await this.context.globalState.update(LAST_UPDATE_CHECK_KEY, Date.now());
    try {
      const result = await this.createCli().update();
      this.logCommandOutput(result.stdout, result.stderr);
    } catch (error) {
      this.logger.debug(`Shared CLI update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private reloadConfig(): void {
    this.config = readConfig();
    this.updateReadyStatus();
  }

  private createCli(): TokitokiCli {
    return new TokitokiCli(this.context.extensionPath);
  }

  private pluginUserAgent(): string {
    const extensionVersion = this.context.extension.packageJSON.version ?? '0.0.0';
    return `${vscode.env.appName}/${vscode.version} tokitoki-vscode/${extensionVersion}`;
  }

  private async handleCommandError(error: unknown, message: string, notify: boolean): Promise<void> {
    // Failures are not alarming: the CLI queues events locally and uploads
    // once the network is back, so the status bar stays calm — details go to
    // the tooltip and the log instead of an error-red background.
    this.updateStatus('$(tokitoki-logo) Tokitoki', message);
    if (error instanceof TokitokiCliError) {
      this.logger.error(`${message} ${error.message}`);
      this.logCommandOutput(error.stdout, error.stderr);
    } else {
      this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!notify) {
      return;
    }
    const openLog = vscode.l10n.t('Open Log');
    const selected = await vscode.window.showErrorMessage(message, openLog);
    if (selected === openLog) {
      this.logger.show();
    }
  }

  private logCommandOutput(stdout: string, stderr: string): void {
    const trimmedStdout = stdout.trim();
    const trimmedStderr = stderr.trim();
    if (trimmedStdout) {
      this.logger.debug(`stdout: ${trimmedStdout}`);
    }
    if (trimmedStderr) {
      this.logger.warn(`stderr: ${trimmedStderr}`);
    }
  }

  private updateReadyStatus(): void {
    const parts = [vscode.l10n.t('Tokitoki: tracking coding activity. Click to open your dashboard.')];
    if (this.lastHeartbeatAt) {
      parts.push(vscode.l10n.t('Last heartbeat: {0}.', this.lastHeartbeatAt.toLocaleString()));
    }
    if (this.lastSyncAt) {
      parts.push(vscode.l10n.t('Last AI usage sync: {0}.', this.lastSyncAt.toLocaleString()));
    }
    this.updateStatus('$(tokitoki-logo) Tokitoki', parts.join(' '));
  }

  private updateStatus(text: string, tooltip: string): void {
    this.statusBar.text = text;
    this.statusBar.tooltip = tooltip;
    if (this.config.statusBarEnabled) {
      this.statusBar.show();
    } else {
      this.statusBar.hide();
    }
  }
}

let controller: TokitokiExtension | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  controller = new TokitokiExtension(context, logger);

  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('tokitoki.openDashboard', () => controller?.openDashboard()),
    vscode.commands.registerCommand('tokitoki.setApiKey', () => controller?.setApiKey()),
    vscode.commands.registerCommand('tokitoki.showApiKeyStatus', () => controller?.showApiKeyStatus()),
    vscode.commands.registerCommand('tokitoki.setProjectName', () => controller?.setProjectName()),
  );

  void controller.initialize();
}

export async function deactivate(): Promise<void> {
  const active = controller;
  controller = undefined;
  await active?.shutdown();
}
