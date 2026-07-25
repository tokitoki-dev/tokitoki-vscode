import * as vscode from 'vscode';

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

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
    baseUrl: config.get<string>('baseUrl', '').trim(),
    statusBarEnabled: config.get<boolean>('statusBar.enabled', true),
    showNotifications: config.get<boolean>('showNotifications', true),
    commandTimeoutSeconds: Math.max(5, Number(commandTimeoutSeconds) || 140),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info',
  };
}
