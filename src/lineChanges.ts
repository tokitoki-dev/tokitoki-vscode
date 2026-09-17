/**
 * Lines a human typed, per file, waiting for the next heartbeat to carry them.
 *
 * The server splits line churn by who produced it on source_type: an agent's
 * file_edit reports its own diff, and everything on an IDE heartbeat counts
 * as a person at a keyboard. So the one thing this must get right is to count
 * only what a person typed. VS Code reports every edit the same way — a
 * keystroke, a paste, an inline completion, a formatter, an agent rewriting
 * the file on disk — and the shape of the change is the only tell:
 *
 *   typed:  a single change that inserts at most one character (plus the
 *           whitespace auto-indent adds after Enter) or deletes a range
 *   bulk:   anything else — one change inserting a block, or several changes
 *           at once (a formatter, a multi-cursor paste)
 *
 * Bulk changes are dropped, not misfiled: a Copilot completion is not human
 * work, and an agent's edit is already counted from its own log. The rule is
 * WakaTime's, which has drawn the same line for years.
 *
 * Counted per change rather than as a document line-count delta so that
 * additions and removals survive separately: typing a line then deleting
 * another is +1/−1, not 0.
 */

/** The part of vscode.TextDocumentContentChangeEvent this needs — a plain
 * shape so the rule is testable without an editor. */
export interface ContentChange {
  text: string;
  startLine: number;
  endLine: number;
}

export interface LineDelta {
  added: number;
  removed: number;
}

export function isTyped(changes: readonly ContentChange[]): boolean {
  if (changes.length !== 1) {
    return false;
  }
  const text = changes[0].text;
  return text.length === 0 || text.trim().length <= 1;
}

/** The lines a single typed change adds and removes. Only the newlines
 * matter: a character on an existing line changes no line count. */
export function delta(change: ContentChange): LineDelta {
  const added = (change.text.match(/\n/g) ?? []).length;
  const removed = change.endLine - change.startLine;
  return { added, removed };
}

export class LineChanges {
  private readonly pending = new Map<string, LineDelta>();

  /** Records an edit event against its file; bulk edits count for nothing. */
  public record(entity: string, changes: readonly ContentChange[]): void {
    if (!isTyped(changes)) {
      return;
    }
    const { added, removed } = delta(changes[0]);
    if (added === 0 && removed === 0) {
      return;
    }
    const current = this.pending.get(entity) ?? { added: 0, removed: 0 };
    current.added += added;
    current.removed += removed;
    this.pending.set(entity, current);
  }

  /** Whether a file has lines no heartbeat has carried yet. */
  public has(entity: string): boolean {
    return this.pending.has(entity);
  }

  /** Hands over a file's lines and forgets them: each line rides exactly one
   * heartbeat. A file with nothing pending yields zeros. */
  public take(entity: string): LineDelta {
    const current = this.pending.get(entity) ?? { added: 0, removed: 0 };
    this.pending.delete(entity);
    return current;
  }

  public clear(): void {
    this.pending.clear();
  }
}
