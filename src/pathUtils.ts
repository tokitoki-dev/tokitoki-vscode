import * as os from 'os';
import * as path from 'path';

export function expandPath(
  rawPath: string,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  let expanded = rawPath.trim();
  if (!expanded) {
    return '';
  }

  if (expanded === '~') {
    expanded = homeDir;
  } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
    expanded = path.join(homeDir, expanded.slice(2));
  }

  return expanded.replace(/\$(\w+)|\${([^}]+)}|%([^%]+)%/g, (match, unixName, bracedName, winName) => {
    const name = unixName || bracedName || winName;
    return env[name] ?? match;
  });
}

export function normalizeProviderDir(rawValue: string): string | undefined {
  const separator = rawValue.indexOf('=');
  if (separator <= 0 || separator === rawValue.length - 1) {
    return undefined;
  }

  const provider = rawValue.slice(0, separator).trim();
  const dir = expandPath(rawValue.slice(separator + 1));
  if (!provider || !dir) {
    return undefined;
  }
  return `${provider}=${dir}`;
}
