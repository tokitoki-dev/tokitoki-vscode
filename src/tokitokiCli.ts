import { execFile, ExecFileException } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { TOKITOKI_DATA_DIR } from './buildConfig';

// A single CLI call has no business running longer than this. Long enough for
// a slow first sync on a bad network, short enough that a wedged process does
// not hang the extension forever.
const COMMAND_TIMEOUT_MS = 140 * 1000;

// Exit code the CLI reserves for "no API key is configured" (cmd/tokitoki:
// exitNoAPIKey). Any other non-zero exit is a transient failure.
const EXIT_NO_API_KEY = 3;

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface HeartbeatArgs {
  entity: string;
  timeSeconds: number;
  /**
   * The editor this heartbeat came from, reported verbatim. The extension runs
   * on every VS Code fork, so this is the fork's own name — "Cursor",
   * "VSCodium" — not "vscode". Mapping those to display names belongs on the
   * server, which can name a fork that did not exist when this build shipped.
   */
  editor: string;
  project?: string;
  projectFolder?: string;
  /** Omitted, the CLI detects one from the entity's path. */
  language?: string;
  plugin?: string;
  category?: string;
  isWrite?: boolean;
  lineNumber?: number;
  cursorPosition?: number;
  linesInFile?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

/** The JSON report of `tokitoki stats` (tokitoki-cli internal/usagestats).
 * Computed entirely from the local event database — no API key, no network. */
export interface StatsReport {
  days: number;
  from: string;
  to: string;
  totals: StatsTotals;
  /** Dense: one entry per day of the window, zero-filled, oldest first. */
  daily: StatsDaily[];
  providers: StatsGroup[];
  models: StatsGroup[];
  projects: StatsGroup[];
  /** Present when the report was requested with a project scope: the same
   * shape narrowed to that project, from the same invocation. */
  project?: StatsReport;
}

export interface StatsTotals {
  events: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  active_seconds: number;
}

export interface StatsDaily {
  date: string;
  events: number;
  total_tokens: number;
  active_seconds: number;
}

export interface StatsGroup {
  name: string;
  events: number;
  total_tokens: number;
  active_seconds: number;
}

/** The JSON of `tokitoki today` (tokitoki-cli internal/statusbar): today's
 * figure as the server computes it for the account behind the key. */
export interface TodayReport {
  date: string;
  timezone: string;
  scope: 'personal' | 'team';
  team_name?: string;
  active_seconds: number;
  total_tokens: number;
  /** Ready to display, e.g. "3h 23m". */
  text: string;
  /** Served from the CLI's cache because the server was unreachable. */
  stale: boolean;
  fetched_at: string;
}

export class TokitokiCliError extends Error {
  public readonly stdout: string;
  public readonly stderr: string;
  public readonly code: string | number | null | undefined;
  public readonly command: string;

  constructor(message: string, command: string, error: ExecFileException, stdout: string, stderr: string) {
    super(message);
    this.name = 'TokitokiCliError';
    this.command = command;
    this.code = error.code;
    this.stdout = stdout;
    this.stderr = stderr;
  }

  /**
   * True only when the CLI reports that no key is configured. Every other
   * failure — offline, server down, timeout — is transient and must not send
   * the user to the key prompt: their key is fine.
   */
  public get isMissingApiKey(): boolean {
    return this.code === EXIT_NO_API_KEY;
  }
}

export class TokitokiCli {
  constructor(private readonly extensionPath: string) {}

  /**
   * The CLI shared by every Tokitoki client on this machine. The location is
   * a contract documented in tokitoki-cli/README.md: resolve it first and
   * fall back to the bundled copy only when it is missing.
   *
   * The directory is the one this build was stamped with (`.tokitoki` for a
   * release, `.tokitoki-dev` for a local build), which is also the directory
   * the bundled CLI owns. A dev build therefore never runs, seeds or updates
   * the installed production CLI, and never touches its API key or queue.
   */
  public static sharedBinaryPath(): string {
    const name = process.platform === 'win32' ? 'tokitoki.exe' : 'tokitoki';
    return path.join(os.homedir(), TOKITOKI_DATA_DIR, 'bin', name);
  }

  public bundledBinaryPath(): string {
    return path.join(this.extensionPath, 'bin', bundledExecutableName());
  }

  public resolveExecutable(): string {
    const shared = TokitokiCli.sharedBinaryPath();
    if (isExecutable(shared)) {
      return shared;
    }
    const bundled = this.bundledBinaryPath();
    if (isExecutable(bundled)) {
      return bundled;
    }
    if (!fs.existsSync(bundled)) {
      throw new Error(`Bundled tokitoki CLI is missing: ${bundled}`);
    }
    // Only when the packaged bit did not survive install. This runs on every
    // heartbeat, so the common path must not touch the filesystem twice.
    if (process.platform !== 'win32') {
      fs.chmodSync(bundled, 0o755);
    }
    return bundled;
  }

  /**
   * Seeds the shared CLI from the bundled copy when the shared one is missing
   * or older, then lets `tokitoki update` keep it fresh. Never a downgrade:
   * a bundled CLI older than the shared one leaves the shared one alone, and
   * a bundled build that cannot report a version only fills a hole.
   * The staged copy is renamed into place so no invocation ever sees a
   * half-written binary.
   */
  public async bootstrapSharedCli(): Promise<void> {
    const bundled = this.bundledBinaryPath();
    if (!fs.existsSync(bundled)) {
      return;
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(bundled, 0o755);
    }

    const shared = TokitokiCli.sharedBinaryPath();
    if (isExecutable(shared)) {
      const bundledVersion = await this.binaryVersion(bundled);
      if (!bundledVersion) {
        return;
      }
      const sharedVersion = await this.binaryVersion(shared);
      if (sharedVersion && !lessThan(sharedVersion, bundledVersion)) {
        return;
      }
      // Shared is older — or cannot even report a version, in which case a
      // binary that works replaces one that does not.
    }

    fs.mkdirSync(path.dirname(shared), { recursive: true });
    const staging = `${shared}.seed`;
    fs.rmSync(staging, { force: true });
    fs.copyFileSync(bundled, staging);
    if (process.platform !== 'win32') {
      fs.chmodSync(staging, 0o755);
    }
    fs.renameSync(staging, shared);
  }

  /** Asks the shared CLI to update itself. The CLI owns the whole sequence. */
  public update(): Promise<CommandResult> {
    return this.run(['update']);
  }

  /** One AI usage scan-and-upload run over the CLI's default provider dirs.
   * Spelled out as `sync`: a bare `tokitoki` prints usage and exits 0, which
   * this extension would happily mistake for a successful sync. */
  public sync(): Promise<CommandResult> {
    return this.run(['sync']);
  }

  public heartbeat(args: HeartbeatArgs): Promise<CommandResult> {
    const command = [
      'heartbeat',
      '--entity', args.entity,
      '--time', args.timeSeconds.toFixed(3),
      '--editor', args.editor,
    ];
    if (args.project) {
      command.push('--project', args.project);
    }
    if (args.projectFolder) {
      command.push('--project-folder', args.projectFolder);
    }
    if (args.language) {
      command.push('--language', args.language);
    }
    if (args.plugin) {
      command.push('--plugin', args.plugin);
    }
    if (args.category) {
      command.push('--category', args.category);
    }
    if (args.isWrite) {
      command.push('--write');
    }
    if (args.lineNumber && args.lineNumber > 0) {
      command.push('--lineno', String(args.lineNumber));
    }
    if (args.cursorPosition && args.cursorPosition > 0) {
      command.push('--cursorpos', String(args.cursorPosition));
    }
    if (args.linesInFile && args.linesInFile > 0) {
      command.push('--lines-in-file', String(args.linesInFile));
    }
    if (args.linesAdded && args.linesAdded > 0) {
      command.push('--lines-added', String(args.linesAdded));
    }
    if (args.linesRemoved && args.linesRemoved > 0) {
      command.push('--lines-removed', String(args.linesRemoved));
    }
    return this.run(command);
  }

  public setApiKey(apiKey: string): Promise<CommandResult> {
    return this.run(['set', 'key', apiKey]);
  }

  public getApiKey(): Promise<CommandResult> {
    return this.run(['get', 'key']);
  }

  /** Checks the stored key against the server; true is valid, false is
   * rejected. A check that cannot run (offline, server trouble) throws. */
  public async verifyApiKey(): Promise<boolean> {
    const result = await this.run(['verify', 'key']);
    // Exit 0 does not promise parseable stdout. Unreadable output means the
    // check did not run — which is not the same as "the key is invalid", so
    // it throws rather than reporting a verdict nobody established.
    let parsed: { valid?: boolean };
    try {
      parsed = JSON.parse(result.stdout) as { valid?: boolean };
    } catch {
      throw new Error(`Unreadable response from 'tokitoki verify key': ${result.stdout.trim() || '(empty)'}`);
    }
    return parsed.valid === true;
  }

  public async dashboardUrl(): Promise<string> {
    const result = await this.run(['get', 'dashboard-url']);
    return result.stdout.trim();
  }

  /** Local usage aggregates for the stats view; `project` narrows the report
   * to one project name. A CLI predating the `stats` command rejects it with
   * a usage error, which surfaces here as a throw — the caller renders that
   * as "update the CLI", not as an empty chart. */
  public async stats(days: number, project?: string): Promise<StatsReport> {
    const args = ['stats', '--days', String(days)];
    if (project) {
      args.push('--project', project);
    }
    const result = await this.run(args);
    try {
      return JSON.parse(result.stdout) as StatsReport;
    } catch {
      throw new Error(`Unreadable response from 'tokitoki stats': ${result.stdout.trim() || '(empty)'}`);
    }
  }

  /** Today's figure from the server, or the CLI's last cached answer marked
   * stale when offline. No key throws with isMissingApiKey set. */
  public async today(): Promise<TodayReport> {
    const result = await this.run(['today']);
    try {
      return JSON.parse(result.stdout) as TodayReport;
    } catch {
      throw new Error(`Unreadable response from 'tokitoki today': ${result.stdout.trim() || '(empty)'}`);
    }
  }

  private async binaryVersion(executable: string): Promise<number[] | undefined> {
    try {
      const result = await this.runBinary(executable, ['version']);
      const parts = result.stdout.trim().replace(/^v/, '').split('.');
      if (parts.length !== 3) {
        return undefined;
      }
      const components = parts.map((part) => Number.parseInt(part, 10));
      return components.some(Number.isNaN) ? undefined : components;
    } catch {
      return undefined;
    }
  }

  private run(args: string[]): Promise<CommandResult> {
    return this.runBinary(this.resolveExecutable(), args);
  }

  private runBinary(executable: string, args: string[]): Promise<CommandResult> {
    const command = [executable, ...args].join(' ');
    // Nothing about where the CLI reports or keeps state is passed here: the
    // binary carries both as build stamps and reads neither from the
    // environment (tokitoki-cli/Makefile), so no setting and no inherited
    // variable can redirect where the API key and usage data are sent.

    // No cwd: the CLI resolves everything it touches from os.UserHomeDir(),
    // so it has none. Pinning one to extensionPath only added a way to fail —
    // VS Code deletes and recreates that directory on extension update, and a
    // spawn whose chdir() misses reports ENOENT against the *executable*,
    // which reads as a missing binary that is in fact sitting right there.
    return new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          timeout: COMMAND_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const result = {
            stdout: stdout.toString(),
            stderr: stderr.toString(),
          };
          if (error) {
            const detail = result.stderr.trim() || result.stdout.trim() || error.message;
            reject(new TokitokiCliError(`tokitoki command failed: ${detail}`, command, error, result.stdout, result.stderr));
            return;
          }
          resolve(result);
        },
      );
    });
  }

}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) {
    return 'configured';
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function bundledExecutableName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const target = `${platform}-${arch}`;
  switch (target) {
    case 'darwin-x64':
      return 'tokitoki-darwin-amd64';
    case 'darwin-arm64':
      return 'tokitoki-darwin-arm64';
    case 'linux-x64':
      return 'tokitoki-linux-amd64';
    case 'linux-arm64':
      return 'tokitoki-linux-arm64';
    case 'win32-x64':
      return 'tokitoki-windows-amd64.exe';
    case 'win32-arm64':
      return 'tokitoki-windows-arm64.exe';
    default:
      throw new Error(`Unsupported Tokitoki CLI platform: ${target}`);
  }
}

export function lessThan(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) {
      return left < right;
    }
  }
  return false;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
