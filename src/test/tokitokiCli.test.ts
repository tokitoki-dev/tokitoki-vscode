import assert from 'node:assert/strict';
import test from 'node:test';
import * as os from 'os';
import * as path from 'path';

import { TOKITOKI_DATA_DIR } from '../buildConfig';
import { TokitokiCli } from '../tokitokiCli';

test('shared CLI lives under the data directory this build was stamped with', () => {
  const name = process.platform === 'win32' ? 'tokitoki.exe' : 'tokitoki';
  assert.equal(
    TokitokiCli.sharedBinaryPath(),
    path.join(os.homedir(), TOKITOKI_DATA_DIR, 'bin', name),
  );
});

test('a build stamped for the dev data dir never resolves the production one', () => {
  // `npm test` runs without TOKITOKI_DATA_DIR, so this pins the default; the
  // Makefile and the F5 tasks override it to .tokitoki-dev.
  assert.equal(TOKITOKI_DATA_DIR, process.env.TOKITOKI_DATA_DIR || '.tokitoki');
  assert.ok(TokitokiCli.sharedBinaryPath().includes(`${path.sep}${TOKITOKI_DATA_DIR}${path.sep}`));
});
