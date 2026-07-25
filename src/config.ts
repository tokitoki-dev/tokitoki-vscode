import * as vscode from 'vscode';

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

/** The server this build talks to, fixed at compile time — the same rule as
 * the macOS app's AppConfig. The tokitoki.baseUrl setting is the only
 * runtime override; ambient TOKITOKI_BASE_URL in the editor's environment is
 * deliberately ignored because the extension passes its resolved URL to
 * every CLI invocation explicitly. */
export const DEFAULT_SERVER_URL = 'https://tokitoki.dev';

export interface ExtensionConfig {
  enabled: boolean;
  autoSync: boolean;
  baseUrl: string;
  statusBarEnabled: boolean;
  showNotifications: boolean;
  commandTimeoutSeconds: number;
  logLevel: LogLevelName;
}

export function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('tokitoki');
  const commandTimeoutSeconds = config.get<number>('commandTimeoutSeconds', 140);
  const logLevel = config.get<LogLevelName>('logLevel', 'info');

  return {
    enabled: config.get<boolean>('enabled', true),
    autoSync: config.get<boolean>('autoSync', true),
    baseUrl: config.get<string>('baseUrl', '').trim() || DEFAULT_SERVER_URL,
    statusBarEnabled: config.get<boolean>('statusBar.enabled', true),
    showNotifications: config.get<boolean>('showNotifications', true),
    commandTimeoutSeconds: Math.max(5, Number(commandTimeoutSeconds) || 140),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info',
  };
}
