import * as vscode from 'vscode';

export interface ExtensionConfig {
  statusBarEnabled: boolean;
  /** Show today's active time in the item; off keeps the icon only and
   * moves the figure to the tooltip. */
  statusBarShowTime: boolean;
}

export function readConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('tokitoki');

  return {
    statusBarEnabled: config.get<boolean>('statusBar.enabled', true),
    statusBarShowTime: config.get<boolean>('statusBar.showTime', true),
  };
}
