import assert from 'node:assert/strict';
import test from 'node:test';

import { expandPath, normalizeProviderDir } from '../pathUtils';
import { bundledExecutableName } from '../tokitokiCli';

test('bundledExecutableName maps Node platforms to packaged binaries', () => {
  assert.equal(bundledExecutableName('darwin', 'arm64'), 'tokitoki-darwin-arm64');
  assert.equal(bundledExecutableName('darwin', 'x64'), 'tokitoki-darwin-amd64');
  assert.equal(bundledExecutableName('linux', 'arm64'), 'tokitoki-linux-arm64');
  assert.equal(bundledExecutableName('linux', 'x64'), 'tokitoki-linux-amd64');
  assert.equal(bundledExecutableName('win32', 'x64'), 'tokitoki-windows-amd64.exe');
});

test('expandPath supports home and environment variables', () => {
  const env = { TOKITOKI_TEST_ROOT: '/tmp/tokitoki-root' };
  assert.equal(expandPath('~/agent', env, '/Users/tester'), '/Users/tester/agent');
  assert.equal(expandPath('$TOKITOKI_TEST_ROOT/bin', env, '/Users/tester'), '/tmp/tokitoki-root/bin');
  assert.equal(expandPath('${TOKITOKI_TEST_ROOT}/bin', env, '/Users/tester'), '/tmp/tokitoki-root/bin');
  assert.equal(expandPath('%TOKITOKI_TEST_ROOT%/bin', env, '/Users/tester'), '/tmp/tokitoki-root/bin');
});

test('normalizeProviderDir validates provider path values', () => {
  assert.equal(normalizeProviderDir('codex=~/.codex'), `codex=${expandPath('~/.codex')}`);
  assert.equal(normalizeProviderDir('missing-separator'), undefined);
  assert.equal(normalizeProviderDir('=missing-provider'), undefined);
});
