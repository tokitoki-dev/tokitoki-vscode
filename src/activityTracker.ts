import * as vscode from 'vscode';

import { HeartbeatThrottler } from './throttler';

export interface TrackedHeartbeat {
  entity: string;
  timeSeconds: number;
  project?: string;
  projectFolder?: string;
  category: string;
  isWrite: boolean;
  lineNumber: number;
  cursorPosition: number;
  linesInFile: number;
}

const ALLOWED_SCHEMES = ['file', 'vscode-remote'];
const DEBOUNCE_MS = 50;

/**
 * Watches editor activity and emits throttled WakaTime-style heartbeats.
 * Bursty events (typing, selection) coalesce through a short debounce; the
 * throttler then lets one through per interval unless the file, category, or
 * write flag forces it.
 */
export class ActivityTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly throttler = new HeartbeatThrottler();
  private debounceTimer: NodeJS.Timeout | undefined;
  private pendingWrite = false;
  private isDebugging = false;
  private isCompiling = false;

  constructor(private readonly emit: (heartbeat: TrackedHeartbeat) => void) {}

  public start(): void {
    if (this.disposables.length > 0) {
      return;
    }
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.kind === vscode.TextEditorSelectionChangeKind.Command) {
          return;
        }
        this.onEvent(false);
      }),
      vscode.workspace.onDidChangeTextDocument(() => this.onEvent(false)),
      vscode.window.onDidChangeActiveTextEditor(() => this.onEvent(false)),
      vscode.workspace.onDidSaveTextDocument(() => this.onEvent(true)),
      vscode.debug.onDidStartDebugSession(() => {
        this.isDebugging = true;
        this.onEvent(false);
      }),
      vscode.debug.onDidTerminateDebugSession(() => {
        this.isDebugging = false;
        this.onEvent(false);
      }),
      vscode.tasks.onDidStartTask((event) => {
        if (event.execution.task.isBackground) {
          return;
        }
        this.isCompiling = true;
        this.onEvent(false);
      }),
      vscode.tasks.onDidEndTask(() => {
        this.isCompiling = false;
        this.onEvent(false);
      }),
    );
  }

  public stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.pendingWrite = false;
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  public dispose(): void {
    this.stop();
  }

  private onEvent(isWrite: boolean): void {
    // A write within the debounce window must not be downgraded by a
    // trailing selection event, so the flag is sticky until the flush.
    this.pendingWrite = this.pendingWrite || isWrite;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const write = this.pendingWrite;
      this.pendingWrite = false;
      this.flush(write);
    }, DEBOUNCE_MS);
  }

  private flush(isWrite: boolean): void {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    if (!editor || !document || !ALLOWED_SCHEMES.includes(document.uri.scheme)) {
      return;
    }
    const entity = document.uri.fsPath;
    if (!entity) {
      return;
    }

    const category = this.isDebugging ? 'debugging' : this.isCompiling ? 'building' : 'coding';
    const now = Date.now();
    if (!this.throttler.shouldSend(entity, category, now, isWrite)) {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
      ?? vscode.workspace.workspaceFolders?.[0];

    this.emit({
      entity,
      timeSeconds: now / 1000,
      project: workspaceFolder?.name,
      projectFolder: workspaceFolder?.uri.fsPath,
      category,
      isWrite,
      lineNumber: editor.selection.start.line + 1,
      cursorPosition: editor.selection.start.character + 1,
      linesInFile: document.lineCount,
    });
  }
}
