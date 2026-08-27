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

// vsce target → asset filename, the same mapping stage-cli.sh applies. An
// argument narrows the build to that one platform; no argument builds all six.
const vsceTargets = {
  'darwin-x64': 'tokitoki-darwin-amd64',
  'darwin-arm64': 'tokitoki-darwin-arm64',
  'linux-x64': 'tokitoki-linux-amd64',
  'linux-arm64': 'tokitoki-linux-arm64',
  'win32-x64': 'tokitoki-windows-amd64.exe',
  'win32-arm64': 'tokitoki-windows-arm64.exe',
};

// `host` is the dev loop: build this machine's binary from the sibling
// tokitoki-cli checkout and stage it straight into bin/, where a dev
// extension host (preferBundled) picks it up. Node's platform-arch pair is
// the vsce target name, so no extra mapping.
const isHost = process.argv[2] === 'host';
const only = isHost ? `${process.platform}-${process.arch}` : process.argv[2];
if (only && !vsceTargets[only]) {
  throw new Error(`Unsupported target ${only}; expected one of: ${Object.keys(vsceTargets).join(', ')}`);
}
const selected = only ? targets.filter(([, , filename]) => filename === vsceTargets[only]) : targets;

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

// Host builds get a synthetic version that outranks every real release
// (9999 major) and every earlier host build (epoch-seconds patch), so the
// extension's ordinary bootstrap comparison installs each F5 build into the
// shared slot — no dev-only code path in the extension. The server never
// offers a release "newer" than 9999.x, so self-update leaves it alone.
// Release builds are unchanged: exact tag or "dev".
const version = isHost
  ? `9999.0.${Math.floor(Date.now() / 1000)}`
  : releaseVersion();
let ldflags = '-s -w';
if (version) {
  ldflags += ` -X github.com/tokitoki-dev/tokitoki-cli/internal/buildinfo.Version=${version}`;
}
console.log(`Building tokitoki CLI ${version ?? 'dev'}`);

fs.mkdirSync(outputDir, { recursive: true });

for (const [goos, goarch, filename] of selected) {
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

  if (isHost) {
    // Same layout stage-cli.sh produces: bin/ holds exactly one binary.
    const binDir = path.join(extensionRoot, 'bin');
    const staged = path.join(binDir, filename);
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.mkdirSync(binDir);
    fs.copyFileSync(output, staged);
    if (goos !== 'windows') {
      fs.chmodSync(staged, 0o755);
    }
    console.log(`Staged ${filename} into bin/`);
  }
}
