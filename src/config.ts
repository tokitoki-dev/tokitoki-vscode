import * as vscode from 'vscode';

export interface ExtensionConfig {
  statusBarEnabled: boolean;
}

export function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('tokitoki');

  return {
    statusBarEnabled: config.get<boolean>('statusBar.enabled', true),
  };
}
