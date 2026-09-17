import assert from 'node:assert/strict';
import test from 'node:test';

import { languageName } from '../language';

test('VS Code ids translate to the shared language vocabulary', () => {
  assert.equal(languageName('typescriptreact'), 'TypeScript');
  assert.equal(languageName('shellscript'), 'Bash');
  assert.equal(languageName('dockerfile'), 'Docker');
  assert.equal(languageName('plaintext'), 'Text');
});

test('an unknown id yields no language so the CLI detects one from the path', () => {
  assert.equal(languageName('some-extension-language'), undefined);
  assert.equal(languageName(undefined), undefined);
  assert.equal(languageName(''), undefined);
});
