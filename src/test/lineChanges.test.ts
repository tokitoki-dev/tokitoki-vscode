import assert from 'node:assert/strict';
import test from 'node:test';

import { delta, isTyped, LineChanges } from '../lineChanges';

const change = (text: string, startLine = 0, endLine = startLine) => ({ text, startLine, endLine });

test('a keystroke, Enter with auto-indent, and a deletion are typed', () => {
  assert.equal(isTyped([change('a')]), true);
  assert.equal(isTyped([change('\n    ')]), true);
  assert.equal(isTyped([change('', 3, 7)]), true);
});

test('a pasted block, a completion, and a formatter pass are not', () => {
  assert.equal(isTyped([change('const x = 1;\nconst y = 2;\n')]), false);
  assert.equal(isTyped([change('ab')]), false);
  assert.equal(isTyped([change('a'), change('b', 4)]), false);
});

test('delta counts newlines added and lines spanned by the replaced range', () => {
  assert.deepEqual(delta(change('a')), { added: 0, removed: 0 });
  assert.deepEqual(delta(change('\n  ')), { added: 1, removed: 0 });
  assert.deepEqual(delta(change('', 3, 7)), { added: 0, removed: 4 });
});

test('lines accumulate per file and ride exactly one heartbeat', () => {
  const lines = new LineChanges();
  lines.record('/a.ts', [change('\n')]);
  lines.record('/a.ts', [change('x')]);
  lines.record('/a.ts', [change('', 2, 5)]);
  lines.record('/b.ts', [change('\n')]);
  lines.record('/a.ts', [change('paste\nmany\nlines\n')]);
  assert.equal(lines.has('/a.ts'), true);
  assert.deepEqual(lines.take('/a.ts'), { added: 1, removed: 3 });
  assert.equal(lines.has('/a.ts'), false);
  assert.deepEqual(lines.take('/a.ts'), { added: 0, removed: 0 });
  assert.deepEqual(lines.take('/b.ts'), { added: 1, removed: 0 });
});

test('a change that moves no line count leaves nothing pending', () => {
  const lines = new LineChanges();
  lines.record('/a.ts', [change('x')]);
  assert.equal(lines.has('/a.ts'), false);
});
