import * as vscode from 'vscode';

import { TOKITOKI_BASE_URL } from './serverUrl';

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

export interface ExtensionConfig {
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
    autoSync: config.get<boolean>('autoSync', true),
    // The server is fixed at compile time (scripts/generate-server-url.js);
    // the tokitoki.baseUrl setting is the only runtime override. Ambient
    // environment variables never decide the server: the extension passes
    // its resolved URL to every CLI invocation explicitly.
    baseUrl: config.get<string>('baseUrl', '').trim() || TOKITOKI_BASE_URL,
    statusBarEnabled: config.get<boolean>('statusBar.enabled', true),
    showNotifications: config.get<boolean>('showNotifications', true),
    commandTimeoutSeconds: Math.max(5, Number(commandTimeoutSeconds) || 140),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info',
  };
}
