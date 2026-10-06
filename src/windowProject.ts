import * as vscode from 'vscode';

import { TokitokiCli } from './tokitokiCli';

/**
 * The project this window's first folder reports on its heartbeats, as the
 * CLI decides it — a pinned `.tokitoki` name, the repository around the
 * folder, or the folder itself — so every reader (the stats view, the status
 * bar) asks about the same project the heartbeats file under. Undefined
 * without a folder.
 */
export async function windowProjectName(cli: TokitokiCli): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return (await cli.project(folder.uri.fsPath)).project;
}
