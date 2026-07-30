import * as vscode from 'vscode';

type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevelName, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Everything lands in the Tokitoki output channel, which nobody has open
// unless they are debugging. There is nothing to spare the user from, so
// there is nothing to configure.
const LOG_LEVEL: LogLevelName = 'debug';

export class Logger implements vscode.Disposable {
  private readonly outputChannel = vscode.window.createOutputChannel('Tokitoki');

  public debug(message: string): void {
    this.log('debug', message);
  }

  public info(message: string): void {
    this.log('info', message);
  }

  public warn(message: string): void {
    this.log('warn', message);
  }

  public error(message: string): void {
    this.log('error', message);
  }

  public errorException(error: unknown): void {
    this.error(error instanceof Error ? error.message : String(error));
  }

  public show(): void {
    this.outputChannel.show();
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }

  private log(level: LogLevelName, message: string): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[LOG_LEVEL]) {
      return;
    }
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
  }
}

