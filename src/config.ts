import * as vscode from 'vscode';

export interface ExtensionConfig {
  autoSync: boolean;
  statusBarEnabled: boolean;
}

export function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('tokitoki');

  return {
    autoSync: config.get<boolean>('autoSync', true),
    statusBarEnabled: config.get<boolean>('statusBar.enabled', true),
  };
}
