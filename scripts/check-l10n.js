// Fails the build when a translation bundle drifts from the source.
//
// Two independent string tables have to stay in step with the code, and
// nothing but this script notices when they stop:
//
//   l10n/bundle.l10n.<lang>.json  keyed by the literal passed to vscode.l10n.t()
//   package.nls.<lang>.json       keyed by the %name% placeholders in package.json
//
// A missing key is a string that silently renders in English; a stale key is
// dead weight that makes the next translator guess. Both are invisible at
// runtime, which is why they accumulated unnoticed before this check existed.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

/** Every literal handed to vscode.l10n.t() across the sources. Template
 * literals are deliberately not matched: l10n keys must be static, so a
 * backtick here is itself the bug. */
function sourceKeys() {
  const dir = path.join(root, 'src');
  const keys = new Set();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        const text = fs.readFileSync(full, 'utf8');
        for (const match of text.matchAll(/l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
          keys.add(match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
        }
      }
    }
  };
  walk(dir);
  return keys;
}

/** The %placeholder% names package.json actually references. */
function manifestKeys() {
  const text = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  return new Set([...text.matchAll(/%([a-zA-Z0-9._]+)%/g)].map((match) => match[1]));
}

function bundles(prefix) {
  const dir = prefix.startsWith('l10n') ? path.join(root, 'l10n') : root;
  const base = path.basename(prefix);
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(base) && name.endsWith('.json'))
    .map((name) => path.join(dir, name));
}

const problems = [];

/** One table against its source of truth. `required` keys must all be present;
 * anything outside them is stale. */
function compare(file, required) {
  const keys = new Set(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))));
  const relative = path.relative(root, file);
  const missing = [...required].filter((key) => !keys.has(key)).sort();
  const stale = [...keys].filter((key) => !required.has(key)).sort();
  for (const key of missing) {
    problems.push(`${relative}: missing translation for ${JSON.stringify(key)}`);
  }
  for (const key of stale) {
    problems.push(`${relative}: stale key ${JSON.stringify(key)} — no longer used in source`);
  }
}

const source = sourceKeys();
for (const file of bundles('l10n/bundle.l10n.')) {
  compare(file, source);
}

// package.nls.json is the English original rather than a translation, so it
// defines nothing on its own — every language file, itself included, is
// checked against what package.json references.
const manifest = manifestKeys();
for (const file of bundles('package.nls')) {
  compare(file, manifest);
}

if (problems.length > 0) {
  console.error('Translation bundles are out of sync:\n');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`Translations in sync: ${source.size} runtime strings, ${manifest.size} manifest strings.`);
