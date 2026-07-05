import { execFile, ExecFileException } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { ExtensionConfig } from './config';
import { normalizeProviderDir } from './pathUtils';

export interface CommandResult {
  stdout: string;
  stderr: string;
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
}

export class TokitokiCli {
  constructor(
    private readonly config: ExtensionConfig,
    private readonly extensionPath: string,
  ) {}

  public resolveExecutable(): string {
    const executable = path.join(this.extensionPath, 'bin', bundledExecutableName());
    if (!fs.existsSync(executable)) {
      throw new Error(`Bundled tokitoki CLI is missing: ${executable}`);
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(executable, 0o755);
    }
    return executable;
  }

  public sync(): Promise<CommandResult> {
    return this.run(this.providerArgs());
  }

  public setApiKey(apiKey: string): Promise<CommandResult> {
    return this.run(['set', 'key', apiKey]);
  }

  public getApiKey(): Promise<CommandResult> {
    return this.run(['get', 'key']);
  }

  public service(action: 'install' | 'start' | 'stop' | 'restart' | 'status'): Promise<CommandResult> {
    const args = ['service', action, ...this.providerArgs()];
    if (action === 'install' || action === 'restart') {
      args.push('--interval', `${this.config.syncIntervalMinutes}m`);
    }
    return this.run(args);
  }

  private run(args: string[]): Promise<CommandResult> {
    const executable = this.resolveExecutable();
    const command = [executable, ...args].join(' ');
    const env = {
      ...process.env,
      TOKITOKI_BASE_URL: this.config.baseUrl || process.env.TOKITOKI_BASE_URL || 'http://localhost:9093',
    };

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

  private providerArgs(): string[] {
    const args: string[] = [];
    for (const value of this.config.providerDirs) {
      const normalized = normalizeProviderDir(value);
      if (normalized) {
        args.push('--provider-dir', normalized);
      }
    }
    return args;
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
      throw new Error(`Unsupported TokiToki CLI platform: ${target}`);
  }
}
