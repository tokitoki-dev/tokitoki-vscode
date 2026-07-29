import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_THROTTLE_MS, HeartbeatThrottler } from '../throttler';
import { lessThan, TokitokiCliError } from '../tokitokiCli';

test('throttler sends the first heartbeat and throttles repeats', () => {
  const throttler = new HeartbeatThrottler();
  assert.equal(throttler.shouldSend('/a.ts', 'coding', 0, false), true);
  assert.equal(throttler.shouldSend('/a.ts', 'coding', 1000, false), false);
  assert.equal(throttler.shouldSend('/a.ts', 'coding', DEFAULT_THROTTLE_MS - 1, false), false);
  assert.equal(throttler.shouldSend('/a.ts', 'coding', DEFAULT_THROTTLE_MS, false), true);
});

test('throttler always passes writes and records them', () => {
  const throttler = new HeartbeatThrottler();
  assert.equal(throttler.shouldSend('/a.ts', 'coding', 0, false), true);
  assert.equal(throttler.shouldSend('/a.ts', 'coding', 1000, true), true);
  // The write reset the clock: the next plain heartbeat is throttled from it.
  assert.equal(throttler.shouldSend('/a.ts', 'coding', 2000, false), false);
});

test('throttler passes entity and category changes immediately', () => {
  const throttler = new HeartbeatThrottler();
  assert.equal(throttler.shouldSend('/a.ts', 'coding', 0, false), true);
  assert.equal(throttler.shouldSend('/b.ts', 'coding', 1, false), true);
  assert.equal(throttler.shouldSend('/b.ts', 'debugging', 2, false), true);
  assert.equal(throttler.shouldSend('/b.ts', 'debugging', 3, false), false);
});

test('throttler rejects non-positive intervals', () => {
  assert.throws(() => new HeartbeatThrottler(0));
  assert.throws(() => new HeartbeatThrottler(-1));
});

test('lessThan compares semver component arrays', () => {
  assert.equal(lessThan([1, 2, 3], [1, 2, 4]), true);
  assert.equal(lessThan([1, 2, 3], [1, 2, 3]), false);
  assert.equal(lessThan([2, 0, 0], [1, 9, 9]), false);
  assert.equal(lessThan([0, 9, 0], [1, 0, 0]), true);
});

// The distinction that decides whether the user gets sent to the key prompt:
// only the CLI's dedicated exit code means "no key". A network failure whose
// message happens to mention the API key must not be mistaken for one.
test('isMissingApiKey follows the exit code, not the error text', () => {
  const build = (code: number, stderr: string) =>
    new TokitokiCliError('failed', 'tokitoki verify key', Object.assign(new Error('x'), { code }), '', stderr);

  assert.equal(build(3, 'API key is not configured in ~/.tokitoki/api_key').isMissingApiKey, true);
  assert.equal(build(1, 'verify API key: dial tcp: connection refused').isMissingApiKey, false);
  assert.equal(build(1, 'something else broke').isMissingApiKey, false);
  assert.equal(build(2, 'usage: tokitoki verify key').isMissingApiKey, false);
});
