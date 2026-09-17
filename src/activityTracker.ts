import * as vscode from 'vscode';

import { languageName } from './language';
import { LineChanges } from './lineChanges';
import { HeartbeatThrottler } from './throttler';

export interface TrackedHeartbeat {
  entity: string;
  timeSeconds: number;
  project?: string;
  projectFolder?: string;
  /** The shared language name, when VS Code's id translates to one. */
  language?: string;
  category: string;
  isWrite: boolean;
  lineNumber: number;
  cursorPosition: number;
  linesInFile: number;
  /** Lines the user typed and deleted in this file since its last heartbeat. */
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Where activity is credited: a file on disk, or a notebook. A notebook cell
 * is an editor of its own in VS Code, with a uri of its own scheme, but the
 * work is on the notebook — one entity per .ipynb, the cell index as the
 * "line", the cell language as the language.
 */
interface Target {
  uri: vscode.Uri;
  languageId?: string;
  line: number;
  column: number;
  lineCount: number;
  /** The file is open in a diff, merge or review view: the user is reading
   * a change, not writing one. */
  reviewing: boolean;
}

const ALLOWED_SCHEMES = ['file', 'vscode-remote'];
const NOTEBOOK_CELL_SCHEME = 'vscode-notebook-cell';
const DEBOUNCE_MS = 50;

/**
 * Watches editor activity and emits throttled activity heartbeats.
 * Bursty events (typing, selection) coalesce through a short debounce; the
 * throttler then lets one through per interval unless the file, category, or
 * write flag forces it.
 *
 * Activity is anything the user does in the window, not only edits: reading
 * (scrolling), coming back to the window, switching tabs — including to an AI
 * chat panel — using the terminal, and creating, renaming or deleting files
 * all count. Every one of these is a signal that the user is here; the
 * throttler keeps them to one heartbeat per file per interval, so more
 * sources mean better coverage, not more events. What happens inside a
 * webview (typing into a chat panel) raises no event at all, so that time is
 * only covered when it is bracketed by these.
 */
export class ActivityTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly throttler = new HeartbeatThrottler();
  private debounceTimer: NodeJS.Timeout | undefined;
  private pendingWrite = false;
  private isDebugging = false;
  private isCompiling = false;
  private readonly lines = new LineChanges();
  /**
   * What the last heartbeat was credited to. A webview tab (an AI chat panel
   * opened as an editor) or the terminal leaves no editor active while the
   * user is plainly working on the file they just left, so activity there is
   * credited to that file rather than dropped.
   */
  private lastTarget: Target | undefined;

  constructor(private readonly emit: (heartbeat: TrackedHeartbeat) => void) {}

  public start(): void {
    if (this.disposables.length > 0) {
      return;
    }
    const activity = () => this.onEvent(false);
    const write = () => this.onEvent(true);
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.kind === vscode.TextEditorSelectionChangeKind.Command) {
          return;
        }
        activity();
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const entity = documentEntity(event.document);
        if (entity) {
          this.lines.record(
            entity,
            event.contentChanges.map((change) => ({
              text: change.text,
              startLine: change.range.start.line,
              endLine: change.range.end.line,
            })),
          );
        }
        activity();
      }),
      vscode.workspace.onDidCloseTextDocument((document) => this.flushClosed(document)),
      vscode.window.onDidChangeActiveTextEditor(activity),
      vscode.window.onDidChangeTextEditorVisibleRanges(activity),
      vscode.window.tabGroups.onDidChangeTabs(activity),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          activity();
        }
      }),
      vscode.window.onDidOpenTerminal(activity),
      vscode.window.onDidChangeActiveTerminal(activity),
      vscode.window.onDidChangeTerminalState(activity),
      // Every command run in an integrated terminal (shell integration, on by
      // default for bash/zsh/pwsh). Keystrokes inside a terminal raise no
      // stable event; the command they add up to does.
      vscode.window.onDidStartTerminalShellExecution(activity),
      vscode.workspace.onDidChangeNotebookDocument(activity),
      vscode.window.onDidChangeNotebookEditorSelection(activity),
      vscode.window.onDidChangeActiveNotebookEditor(activity),
      vscode.workspace.onDidSaveTextDocument(write),
      vscode.workspace.onDidSaveNotebookDocument(write),
      vscode.workspace.onDidCreateFiles(write),
      vscode.workspace.onDidRenameFiles(write),
      vscode.workspace.onDidDeleteFiles(write),
      vscode.debug.onDidStartDebugSession(() => {
        this.isDebugging = true;
        activity();
      }),
      vscode.debug.onDidTerminateDebugSession(() => {
        this.isDebugging = false;
        activity();
      }),
      vscode.tasks.onDidStartTask((event) => {
        if (event.execution.task.isBackground) {
          return;
        }
        this.isCompiling = true;
        activity();
      }),
      vscode.tasks.onDidEndTask(() => {
        this.isCompiling = false;
        activity();
      }),
    );
  }

  public stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.pendingWrite = false;
    this.lastTarget = undefined;
    this.lines.clear();
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
    const target = this.resolveTarget();
    if (!target) {
      return;
    }
    this.lastTarget = target;
    const entity = target.uri.fsPath;

    const category = this.isDebugging ? 'debugging'
      : this.isCompiling ? 'building'
      : target.reviewing ? 'code reviewing'
      : 'coding';
    const now = Date.now();
    if (!this.throttler.shouldSend(entity, category, now, isWrite)) {
      return;
    }

    // Lines are taken only once the heartbeat is actually going out: a
    // throttled flush leaves them pending for the one that does.
    const lines = this.lines.take(entity);
    this.emit({
      entity,
      timeSeconds: now / 1000,
      ...projectOf(target.uri),
      language: languageName(target.languageId),
      category,
      isWrite,
      lineNumber: target.line,
      cursorPosition: target.column,
      linesInFile: target.lineCount,
      linesAdded: lines.added,
      linesRemoved: lines.removed,
    });
  }

  /**
   * A closed file with typed lines nobody has carried yet gets one last
   * heartbeat for them, outside the throttle: closing is a real action, and
   * the alternative is those lines waiting for a reopen that may never come.
   */
  private flushClosed(document: vscode.TextDocument): void {
    const entity = documentEntity(document);
    if (!entity || !this.lines.has(entity)) {
      return;
    }
    const lines = this.lines.take(entity);
    this.emit({
      entity,
      timeSeconds: Date.now() / 1000,
      ...projectOf(document.uri),
      language: languageName(document.languageId),
      category: 'coding',
      isWrite: false,
      lineNumber: 0,
      cursorPosition: 0,
      linesInFile: document.lineCount,
      linesAdded: lines.added,
      linesRemoved: lines.removed,
    });
  }

  /**
   * What the user is working on right now: the active text editor (a cell
   * editor stands for its notebook), else the file behind the active diff,
   * else the active notebook, else whatever the last heartbeat went to. Only
   * a file or notebook on disk qualifies — untitled buffers, output panes and
   * the like are not work on a project.
   */
  private resolveTarget(): Target | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const target = editorTarget(vscode.window.activeTextEditor)
      ?? diffTarget(tab)
      ?? notebookTarget(vscode.window.activeNotebookEditor)
      ?? this.lastTarget;
    if (!target) {
      return undefined;
    }
    return { ...target, reviewing: isReviewing(tab, vscode.window.activeTextEditor) };
  }
}

/** The entity a document's activity is credited to: itself, or for a
 * notebook cell its notebook. Undefined for anything not on disk. */
function documentEntity(document: vscode.TextDocument): string | undefined {
  const uri = document.uri.scheme === NOTEBOOK_CELL_SCHEME
    ? notebookOf(document)?.uri
    : document.uri;
  return uri && ALLOWED_SCHEMES.includes(uri.scheme) && uri.fsPath ? uri.fsPath : undefined;
}

function notebookOf(cellDocument: vscode.TextDocument): vscode.NotebookDocument | undefined {
  return vscode.workspace.notebookDocuments.find((candidate) =>
    candidate.getCells().some((cell) => cell.document === cellDocument),
  );
}

function projectOf(uri: vscode.Uri): { project?: string; projectFolder?: string } {
  const folder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  return { project: folder?.name, projectFolder: folder?.uri.fsPath };
}

/** A target on disk, or nothing: every producer below goes through here, so
 * the scheme rule is applied once. */
function onDisk(target: Omit<Target, 'reviewing'>): Target | undefined {
  if (!ALLOWED_SCHEMES.includes(target.uri.scheme) || !target.uri.fsPath) {
    return undefined;
  }
  return { ...target, reviewing: false };
}

function editorTarget(editor: vscode.TextEditor | undefined): Target | undefined {
  if (!editor) {
    return undefined;
  }
  const document = editor.document;
  if (document.uri.scheme === NOTEBOOK_CELL_SCHEME) {
    const notebook = notebookOf(document);
    if (!notebook) {
      return undefined;
    }
    const index = notebook.getCells().findIndex((cell) => cell.document === document);
    return onDisk({
      uri: notebook.uri,
      languageId: document.languageId,
      line: index + 1,
      column: editor.selection.start.character + 1,
      lineCount: notebook.cellCount,
    });
  }
  return onDisk({
    uri: document.uri,
    languageId: document.languageId,
    line: editor.selection.start.line + 1,
    column: editor.selection.start.character + 1,
    lineCount: document.lineCount,
  });
}

/**
 * A diff whose focused side is not a file on disk — an agent's proposed
 * change, say, where both sides are virtual documents — is still a review of
 * the file the diff is about. Whichever side is on disk names it.
 */
function diffTarget(tab: vscode.Tab | undefined): Target | undefined {
  const input = tab?.input;
  if (!(input instanceof vscode.TabInputTextDiff)) {
    return undefined;
  }
  for (const uri of [input.modified, input.original]) {
    const target = onDisk({ uri, line: 0, column: 0, lineCount: 0 });
    if (target) {
      return target;
    }
  }
  return undefined;
}

/** A notebook with no cell focused (scrolling, a rendered markdown cell).
 * Its language is that of its first code cell — what a .ipynb is written in. */
function notebookTarget(editor: vscode.NotebookEditor | undefined): Target | undefined {
  if (!editor) {
    return undefined;
  }
  const notebook = editor.notebook;
  const firstCode = notebook.getCells().find((cell) => cell.kind === vscode.NotebookCellKind.Code);
  return onDisk({
    uri: notebook.uri,
    languageId: firstCode?.document.languageId,
    line: editor.selection.start + 1,
    column: 0,
    lineCount: notebook.cellCount,
  });
}

/**
 * Reading a change rather than making one: a diff editor (git, an agent's
 * proposed edit), a pull request document, or a webview whose
 * name says it is a diff (Codex opens its review as one). The tab is the
 * tell, not the document — the focused side of a git diff is the plain file.
 */
function isReviewing(tab: vscode.Tab | undefined, editor: vscode.TextEditor | undefined): boolean {
  const input = tab?.input;
  if (input instanceof vscode.TabInputTextDiff) {
    return true;
  }
  if (input instanceof vscode.TabInputWebview) {
    return `${input.viewType} ${tab?.label ?? ''}`.toLowerCase().includes('diff');
  }
  return editor?.document.uri.scheme === 'pr';
}
