import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { firstLine, PROJECT_FILE_NAME, readProjectName, replaceFirstLine, writeProjectName } from '../projectFile';

test('first line is the project name, trimmed and BOM-free', () => {
  assert.equal(firstLine('my-project\n'), 'my-project');
  assert.equal(firstLine('\ufeff  my-project  \r\nmain\r\n'), 'my-project');
  assert.equal(firstLine(''), '');
  assert.equal(firstLine('\nmain\n'), '');
});

test('rewriting the name keeps the branch override and the line endings', () => {
  assert.equal(replaceFirstLine('old\nmain\n', 'new'), 'new\nmain\n');
  assert.equal(replaceFirstLine('old\r\nmain\r\n', 'new'), 'new\r\nmain\r\n');
  // A file with no newline at all, and an empty one, both become a one-line file.
  assert.equal(replaceFirstLine('old', 'new'), 'new\n');
  assert.equal(replaceFirstLine('', 'new'), 'new\n');
  // A blank first line is a real case: the CLI reads it as "no override".
  assert.equal(replaceFirstLine('\nmain\n', 'new'), 'new\nmain\n');
});

test('a missing project file reads as no name and is created on write', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tokitoki-project-'));
  try {
    assert.equal(await readProjectName(folder), '');
    await writeProjectName(folder, 'my-project');
    assert.equal(fs.readFileSync(path.join(folder, PROJECT_FILE_NAME), 'utf8'), 'my-project\n');
    assert.equal(await readProjectName(folder), 'my-project');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('an existing branch override survives a rename', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tokitoki-project-'));
  try {
    fs.writeFileSync(path.join(folder, PROJECT_FILE_NAME), 'old\nrelease-1\n');
    await writeProjectName(folder, 'new');
    assert.equal(fs.readFileSync(path.join(folder, PROJECT_FILE_NAME), 'utf8'), 'new\nrelease-1\n');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
