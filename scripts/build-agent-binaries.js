const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..');
const cliDir = path.join(repoRoot, 'tokitoki-cli');
const outputDir = path.join(extensionRoot, '.build', 'cli');

const targets = [
  ['darwin', 'amd64', 'tokitoki-darwin-amd64'],
  ['darwin', 'arm64', 'tokitoki-darwin-arm64'],
  ['linux', 'amd64', 'tokitoki-linux-amd64'],
  ['linux', 'arm64', 'tokitoki-linux-arm64'],
  ['windows', 'amd64', 'tokitoki-windows-amd64.exe'],
  ['windows', 'arm64', 'tokitoki-windows-arm64.exe'],
];

if (!fs.existsSync(path.join(cliDir, 'go.mod'))) {
  throw new Error(`Unable to find tokitoki-cli at ${cliDir}`);
}

// Only an exact release tag stamps a version. Anything else stays "dev", so a
// bundled build of work in progress can seed the shared CLI into an empty
// slot but never replaces a released one.
function releaseVersion() {
  const result = childProcess.spawnSync('git', ['describe', '--tags', '--exact-match'], {
    cwd: cliDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return undefined;
  }
  const tag = result.stdout.trim();
  return /^v\d+\.\d+\.\d+$/.test(tag) ? tag.slice(1) : undefined;
}

const version = releaseVersion();
let ldflags = '-s -w';
if (version) {
  ldflags += ` -X github.com/tokitoki-dev/tokitoki-cli/internal/buildinfo.Version=${version}`;
}
console.log(`Building tokitoki CLI ${version ?? 'dev'}`);

fs.mkdirSync(outputDir, { recursive: true });

for (const [goos, goarch, filename] of targets) {
  const output = path.join(outputDir, filename);
  console.log(`Building ${filename}`);
  const result = childProcess.spawnSync(
    'go',
    ['build', '-trimpath', `-ldflags=${ldflags}`, '-o', output, './cmd/tokitoki'],
    {
      cwd: cliDir,
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
