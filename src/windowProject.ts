import * as vscode from 'vscode';

import { readProjectName } from './projectFile';

/**
 * The name this window's first folder reports on its heartbeats: the pinned
 * `.tokitoki` name when set, the folder name otherwise — so every reader
 * (the stats view, the status bar) asks about the same project the
 * heartbeats file under. Undefined without a folder.
 */
export async function windowProjectName(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  try {
    return (await readProjectName(folder.uri.fsPath)) || folder.name;
  } catch {
    return folder.name;
  }
}
