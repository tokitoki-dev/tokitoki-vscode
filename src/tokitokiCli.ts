import { execFile, ExecFileException } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ExtensionConfig } from './config';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface HeartbeatArgs {
  entity: string;
  timeSeconds: number;
  project?: string;
  projectFolder?: string;
  plugin?: string;
  category?: string;
  isWrite?: boolean;
  lineNumber?: number;
  cursorPosition?: number;
  linesInFile?: number;
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

  public get isMissingApiKey(): boolean {
    return /api key/i.test(this.stderr);
  }
}

export class TokitokiCli {
  constructor(
    private readonly config: ExtensionConfig,
    private readonly extensionPath: string,
  ) {}

  /**
   * The CLI shared by every Tokitoki client on this machine. The location is
   * a contract documented in tokitoki-cli/README.md: resolve it first and
   * fall back to the bundled copy only when it is missing.
   */
  public static sharedBinaryPath(): string {
    const name = process.platform === 'win32' ? 'tokitoki.exe' : 'tokitoki';
    return path.join(os.homedir(), '.tokitoki', 'bin', name);
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
    if (!fs.existsSync(bundled)) {
      throw new Error(`Bundled tokitoki CLI is missing: ${bundled}`);
    }
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

  /** One AI usage scan-and-upload run over the CLI's default provider dirs. */
  public sync(): Promise<CommandResult> {
    return this.run([]);
  }

  public heartbeat(args: HeartbeatArgs): Promise<CommandResult> {
    const command = [
      'heartbeat',
      '--entity', args.entity,
      '--time', args.timeSeconds.toFixed(3),
      '--editor', 'vscode',
    ];
    if (args.project) {
      command.push('--project', args.project);
    }
    if (args.projectFolder) {
      command.push('--project-folder', args.projectFolder);
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
    return this.run(command);
  }

  public setApiKey(apiKey: string): Promise<CommandResult> {
    return this.run(['set', 'key', apiKey]);
  }

  public getApiKey(): Promise<CommandResult> {
    return this.run(['get', 'key']);
  }

  /** Checks the stored key against the server. Returns the CLI's definite
   * answer, or undefined when this CLI predates `verify key` or the check
   * itself could not run (offline, server trouble). */
  public async verifyApiKey(): Promise<boolean | undefined> {
    try {
      const result = await this.run(['verify', 'key']);
      const parsed = JSON.parse(result.stdout) as { ok?: boolean; valid?: boolean };
      return parsed.ok ? parsed.valid === true : undefined;
    } catch {
      return undefined;
    }
  }

  public async dashboardUrl(): Promise<string> {
    const result = await this.run(['get', 'dashboard-url']);
    return result.stdout.trim();
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
    // Always pass the resolved server URL so the CLI's behavior is decided
    // by this build, never by whatever environment the editor inherited.
    const env = { ...process.env, TOKITOKI_BASE_URL: this.config.baseUrl };

    return new Promise((resolve, reject) => {
      execFile(
        executable,
        args,
        {
          cwd: this.extensionPath,
          env,
          timeout: this.config.commandTimeoutSeconds * 1000,
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
