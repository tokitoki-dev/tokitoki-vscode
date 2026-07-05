const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const goagentDir = path.join(repoRoot, 'tracklm-goagent');
const outputDir = path.join(extensionRoot, 'bin');

const targets = [
  ['darwin', 'amd64', 'tokitoki-darwin-amd64'],
  ['darwin', 'arm64', 'tokitoki-darwin-arm64'],
  ['linux', 'amd64', 'tokitoki-linux-amd64'],
  ['linux', 'arm64', 'tokitoki-linux-arm64'],
  ['windows', 'amd64', 'tokitoki-windows-amd64.exe'],
  ['windows', 'arm64', 'tokitoki-windows-arm64.exe'],
];

if (!fs.existsSync(path.join(goagentDir, 'go.mod'))) {
  throw new Error(`Unable to find tracklm-goagent at ${goagentDir}`);
}

fs.mkdirSync(outputDir, { recursive: true });

for (const [goos, goarch, filename] of targets) {
  const output = path.join(outputDir, filename);
  console.log(`Building ${filename}`);
  const result = childProcess.spawnSync(
    'go',
    ['build', '-trimpath', '-ldflags=-s -w', '-o', output, './cmd/tokitoki'],
    {
      cwd: goagentDir,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: goos,
        GOARCH: goarch,
      },
      stdio: 'inherit',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  if (goos !== 'windows') {
    fs.chmodSync(output, 0o755);
  }
}
