import * as vscode from 'vscode';

import { ActivityTracker, TrackedHeartbeat } from './activityTracker';
import { ExtensionConfig, readConfig } from './config';
import { Logger } from './logger';
import { maskApiKey, TokitokiCli, TokitokiCliError } from './tokitokiCli';

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_UPDATE_CHECK_KEY = 'tokitoki.lastUpdateCheckAt';
/** Matches the macOS menu bar app's automatic sync cadence. */
const SYNC_INTERVAL_MS = 30 * 60 * 1000;

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
    );
  }

  public async initialize(): Promise<void> {
    this.logger.info(`Tokitoki extension activated from ${this.context.extensionPath}`);
    this.reloadConfig();
    if (!this.config.enabled) {
      return;
    }

    // Seed the shared CLI before the first invocation so everything binds to
    // the shared copy, then let the CLI update itself — silent, at most daily.
    try {
      await this.createCli().bootstrapSharedCli();
    } catch (error) {
      this.logger.warn(`Failed to seed shared CLI: ${error instanceof Error ? error.message : String(error)}`);
    }
    void this.promptForApiKeyIfMissing();
    if (this.config.autoSync) {
      void this.syncNow(false);
    }
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

  public async syncNow(userInitiated: boolean): Promise<void> {
    if (!this.config.enabled) {
      if (userInitiated) {
        await vscode.window.showInformationMessage('Tokitoki is disabled in settings.');
      }
      return;
    }
    if (this.syncRunning) {
      if (userInitiated) {
        await vscode.window.showInformationMessage('Tokitoki sync is already running.');
      }
      return;
    }

    // Automatic syncs stay silent until a key exists — the activation prompt
    // already asks for one. Same rule as the macOS app's automatic sync.
    if (!userInitiated) {
      try {
        await this.createCli().getApiKey();
      } catch {
        return;
      }
    }

    this.syncRunning = true;
    this.updateStatus('$(sync~spin) Tokitoki', 'Tokitoki AI usage sync in progress');
    this.logger.info('Starting AI usage sync');

    try {
      const result = await this.createCli().sync();
      this.logCommandOutput(result.stdout, result.stderr);
      this.lastSyncAt = new Date();
      this.updateReadyStatus();
      if (userInitiated && this.config.showNotifications) {
        await vscode.window.showInformationMessage('Tokitoki sync completed.');
      }
    } catch (error) {
      await this.handleCommandError(error, 'Tokitoki sync failed.', userInitiated);
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
      prompt: 'Tokitoki API key',
      placeHolder: 'Paste your API key from tokitoki.dev',
      value: existing,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'API key is required'),
    });
    if (!apiKey || apiKey.trim() === existing) {
      return;
    }

    try {
      const result = await this.createCli().setApiKey(apiKey.trim());
      this.logCommandOutput(result.stdout, result.stderr);
      this.updateReadyStatus();
      if (this.config.showNotifications) {
        await vscode.window.showInformationMessage('Tokitoki API key saved.');
      }
      if (this.config.autoSync) {
        void this.syncNow(false);
      }
    } catch (error) {
      await this.handleCommandError(error, 'Unable to save Tokitoki API key.', true);
    }
  }

  public async showApiKeyStatus(): Promise<void> {
    try {
      const result = await this.createCli().getApiKey();
      this.logCommandOutput('', result.stderr);
      const masked = maskApiKey(result.stdout);
      await vscode.window.showInformationMessage(`Tokitoki API key is configured (${masked}).`);
    } catch (error) {
      await this.handleCommandError(error, 'Tokitoki API key is not configured.', true);
    }
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
    await vscode.env.openExternal(vscode.Uri.parse(this.config.baseUrl || 'https://tokitoki.dev'));
  }

  public openOutput(): void {
    this.logger.show();
  }

  public dispose(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.logger.dispose();
  }

  private sendHeartbeat(heartbeat: TrackedHeartbeat): void {
    if (!this.config.enabled) {
      return;
    }
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
    this.updateStatus('$(warning) Tokitoki', 'Tokitoki API key is not configured', true);
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
    this.logger.setLevel(this.config.logLevel);
    this.updateReadyStatus();
    this.restartSyncTimer();
    if (this.config.enabled) {
      this.tracker.start();
    } else {
      this.tracker.stop();
    }
  }

  private restartSyncTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    if (!this.config.enabled || !this.config.autoSync) {
      return;
    }
    this.syncTimer = setInterval(() => {
      void this.syncNow(false);
    }, SYNC_INTERVAL_MS);
  }

  private createCli(): TokitokiCli {
    return new TokitokiCli(this.config, this.context.extensionPath);
  }

  private pluginUserAgent(): string {
    const extensionVersion = this.context.extension.packageJSON.version ?? '0.0.0';
    return `${vscode.env.appName}/${vscode.version} tokitoki-vscode/${extensionVersion}`;
  }

  private async handleCommandError(error: unknown, message: string, notify: boolean): Promise<void> {
    this.updateStatus('$(error) Tokitoki', message, true);
    if (error instanceof TokitokiCliError) {
      this.logger.error(`${message} ${error.message}`);
      this.logCommandOutput(error.stdout, error.stderr);
    } else {
      this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!notify || !this.config.showNotifications) {
      return;
    }
    const openLog = 'Open Log';
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
    if (!this.config.enabled) {
      this.updateStatus('$(circle-slash) Tokitoki', 'Tokitoki is disabled');
      return;
    }
    const parts = ['Tokitoki: tracking coding activity. Click to open your dashboard.'];
    if (this.lastHeartbeatAt) {
      parts.push(`Last heartbeat: ${this.lastHeartbeatAt.toLocaleString()}.`);
    }
    if (this.lastSyncAt) {
      parts.push(`Last AI usage sync: ${this.lastSyncAt.toLocaleString()}.`);
    }
    this.updateStatus('$(pulse) Tokitoki', parts.join(' '));
  }

  private updateStatus(text: string, tooltip: string, error = false): void {
    this.statusBar.text = text;
    this.statusBar.tooltip = tooltip;
    this.statusBar.backgroundColor = error
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined;
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
    vscode.commands.registerCommand('tokitoki.syncNow', () => controller?.syncNow(true)),
    vscode.commands.registerCommand('tokitoki.setApiKey', () => controller?.setApiKey()),
    vscode.commands.registerCommand('tokitoki.showApiKeyStatus', () => controller?.showApiKeyStatus()),
    vscode.commands.registerCommand('tokitoki.openOutput', () => controller?.openOutput()),
  );

  void controller.initialize();
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
