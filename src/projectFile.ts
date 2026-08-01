import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Tokitoki's per-project identity file, read by the CLI from the nearest
 * ancestor of the edited file (tokitoki-cli/internal/projectfile). Line 1 is
 * the project name, line 2 an optional branch override — this extension owns
 * line 1 and leaves the rest of the file exactly as the user wrote it.
 */
export const PROJECT_FILE_NAME = '.tokitoki';

export function projectFilePath(folder: string): string {
  return path.join(folder, PROJECT_FILE_NAME);
}

/**
 * The pinned project name, or '' when the file is absent, unreadable, or its
 * first line is blank. All three mean the same thing to the CLI: no override,
 * fall back to the folder name.
 */
export async function readProjectName(folder: string): Promise<string> {
  return firstLine(await read(folder));
}

/** Rewrites line 1 in place, creating the file when it does not exist. */
export async function writeProjectName(folder: string, name: string): Promise<void> {
  await fs.writeFile(projectFilePath(folder), replaceFirstLine(await read(folder), name), 'utf8');
}

async function read(folder: string): Promise<string> {
  try {
    return await fs.readFile(projectFilePath(folder), 'utf8');
  } catch {
    // Missing is the common case, and an unreadable file is treated the same:
    // both mean there is no name to show, and the write that may follow
    // creates the file the CLI will read.
    return '';
  }
}

export function firstLine(content: string): string {
  const [first = ''] = content.split(/\r?\n/);
  return first.replace(/^\ufeff/, '').trim();
}

/**
 * Everything after line 1 survives untouched — line 2 is the user's branch
 * override and none of this command's business. Existing CRLF endings are
 * kept so the file does not churn in a repository that uses them.
 */
export function replaceFirstLine(content: string, name: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  if (lines.length === 1) {
    return `${name}${eol}`;
  }
  lines[0] = name;
  return lines.join(eol);
}
