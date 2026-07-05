import * as vscode from 'vscode';

import { ExtensionConfig, readConfig } from './config';
import { Logger } from './logger';
import { maskApiKey, TokitokiCli, TokitokiCliError } from './tokitokiCli';

class TokiTokiExtension implements vscode.Disposable {
  private config: ExtensionConfig = readConfig();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusBar: vscode.StatusBarItem;
  private syncTimer: NodeJS.Timeout | undefined;
  private running = false;
  private lastSaveSyncAt = 0;
  private lastSyncAt: Date | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      'tokitoki.status',
      vscode.StatusBarAlignment.Left,
      0,
    );
    this.statusBar.name = 'TokiToki';
    this.statusBar.command = 'tokitoki.syncNow';

    this.disposables.push(
      this.statusBar,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('tokitoki')) {
          this.reloadConfig();
        }
      }),
      vscode.workspace.onDidSaveTextDocument(() => {
        this.handleDocumentSave();
      }),
    );
  }

  public initialize(): void {
    this.logger.info(`TokiToki extension activated from ${this.context.extensionPath}`);
    this.reloadConfig();
    if (this.config.enabled && this.config.autoSync) {
      void this.syncNow(false);
    }
  }

  public async syncNow(userInitiated: boolean): Promise<void> {
    if (!this.config.enabled) {
      this.updateStatus('$(circle-slash) TokiToki', 'TokiToki is disabled');
      if (userInitiated) {
        await vscode.window.showInformationMessage('TokiToki is disabled in settings.');
      }
      return;
    }

    if (this.running) {
      if (userInitiated) {
        await vscode.window.showInformationMessage('TokiToki sync is already running.');
      }
      return;
    }

    this.running = true;
    this.updateStatus('$(sync~spin) TokiToki', 'TokiToki sync in progress');
    this.logger.info('Starting sync');

    try {
      const result = await this.createCli().sync();
      this.logCommandOutput(result.stdout, result.stderr);
      this.lastSyncAt = new Date();
      this.updateReadyStatus('Last sync succeeded');
      if (userInitiated && this.config.showNotifications) {
        await vscode.window.showInformationMessage('TokiToki sync completed.');
      }
    } catch (error) {
      await this.handleCommandError(error, 'TokiToki sync failed.');
    } finally {
      this.running = false;
    }
  }

  public async setApiKey(): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'TokiToki API key',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'API key is required'),
    });
    if (!apiKey) {
      return;
    }

    try {
      const result = await this.createCli().setApiKey(apiKey.trim());
      this.logCommandOutput(result.stdout, result.stderr);
      this.updateReadyStatus('API key saved');
      if (this.config.showNotifications) {
        await vscode.window.showInformationMessage('TokiToki API key saved.');
      }
    } catch (error) {
      await this.handleCommandError(error, 'Unable to save TokiToki API key.');
    }
  }

  public async showApiKeyStatus(): Promise<void> {
    try {
      const result = await this.createCli().getApiKey();
      this.logCommandOutput('', result.stderr);
      const masked = maskApiKey(result.stdout);
      await vscode.window.showInformationMessage(`TokiToki API key is configured (${masked}).`);
    } catch (error) {
      await this.handleCommandError(error, 'TokiToki API key is not configured.');
    }
  }

  public async service(action: 'install' | 'start' | 'stop' | 'restart' | 'status'): Promise<void> {
    try {
      const result = await this.createCli().service(action);
      this.logCommandOutput(result.stdout, result.stderr);
      const output = result.stdout.trim();
      const message = action === 'status'
        ? `TokiToki service status: ${output || 'unknown'}`
        : `TokiToki service ${action} completed.`;
      this.updateReadyStatus(message);
      if (this.config.showNotifications) {
        await vscode.window.showInformationMessage(message);
      }
    } catch (error) {
      await this.handleCommandError(error, `TokiToki service ${action} failed.`);
    }
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

  private reloadConfig(): void {
    this.config = readConfig();
    this.logger.setLevel(this.config.logLevel);
    this.updateStatusVisibility();
    this.updateReadyStatus(this.config.enabled ? 'Ready' : 'Disabled');
    this.restartTimer();
  }

  private restartTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    if (!this.config.enabled || !this.config.autoSync) {
      return;
    }

    this.syncTimer = setInterval(() => {
      void this.syncNow(false);
    }, this.config.syncIntervalMinutes * 60_000);
  }

  private handleDocumentSave(): void {
    if (!this.config.enabled || !this.config.syncOnSave) {
      return;
    }

    const now = Date.now();
    if (now - this.lastSaveSyncAt < 60_000) {
      return;
    }
    this.lastSaveSyncAt = now;
    void this.syncNow(false);
  }

  private createCli(): TokitokiCli {
    return new TokitokiCli(this.config, this.context.extensionPath);
  }

  private async handleCommandError(error: unknown, message: string): Promise<void> {
    this.updateStatus('$(error) TokiToki', message, true);
    if (error instanceof TokitokiCliError) {
      this.logger.error(`${message} ${error.message}`);
      this.logCommandOutput(error.stdout, error.stderr);
    } else {
      this.logger.error(`${message} ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!this.config.showNotifications) {
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

  private updateReadyStatus(tooltipPrefix: string): void {
    const lastSync = this.lastSyncAt ? ` Last sync: ${this.lastSyncAt.toLocaleString()}.` : '';
    this.updateStatus('$(sync) TokiToki', `${tooltipPrefix}.${lastSync}`);
  }

  private updateStatus(text: string, tooltip: string, error = false): void {
    this.statusBar.text = text;
    this.statusBar.tooltip = tooltip;
    this.statusBar.backgroundColor = error
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined;
    this.updateStatusVisibility();
  }

  private updateStatusVisibility(): void {
    if (this.config.statusBarEnabled) {
      this.statusBar.show();
    } else {
      this.statusBar.hide();
    }
  }
}

let controller: TokiTokiExtension | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  controller = new TokiTokiExtension(context, logger);

  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand('tokitoki.syncNow', () => controller?.syncNow(true)),
    vscode.commands.registerCommand('tokitoki.setApiKey', () => controller?.setApiKey()),
    vscode.commands.registerCommand('tokitoki.showApiKeyStatus', () => controller?.showApiKeyStatus()),
    vscode.commands.registerCommand('tokitoki.service.install', () => controller?.service('install')),
    vscode.commands.registerCommand('tokitoki.service.start', () => controller?.service('start')),
    vscode.commands.registerCommand('tokitoki.service.stop', () => controller?.service('stop')),
    vscode.commands.registerCommand('tokitoki.service.restart', () => controller?.service('restart')),
    vscode.commands.registerCommand('tokitoki.service.status', () => controller?.service('status')),
    vscode.commands.registerCommand('tokitoki.openOutput', () => controller?.openOutput()),
  );

  controller.initialize();
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
