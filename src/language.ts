/**
 * VS Code language ids → the language names the rest of Tokitoki uses (the
 * CLI's langdetect vocabulary, itself WakaTime's). Ids are VS Code's own
 * lowercase vocabulary, so this is where they get translated; nobody else
 * speaks it.
 *
 * An id not listed here maps to undefined and the heartbeat carries no
 * language: the CLI then detects one from the path, exactly what happened
 * before the extension started reporting ids. Sending a raw id instead would
 * put "shellscript" on the dashboard beside "Bash".
 */
const LANGUAGE_NAMES: Record<string, string> = {
  astro: 'Astro',
  bat: 'Batchfile',
  c: 'C',
  clojure: 'Clojure',
  cmake: 'CMake',
  coffeescript: 'CoffeeScript',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  csv: 'CSV',
  dart: 'Dart',
  dockerfile: 'Docker',
  elixir: 'Elixir',
  erlang: 'Erlang',
  fsharp: 'F#',
  go: 'Go',
  graphql: 'GraphQL',
  groovy: 'Groovy',
  haskell: 'Haskell',
  html: 'HTML',
  ini: 'INI',
  java: 'Java',
  javascript: 'JavaScript',
  javascriptreact: 'JSX',
  json: 'JSON',
  jsonc: 'JSON',
  julia: 'Julia',
  kotlin: 'Kotlin',
  less: 'Less',
  lua: 'Lua',
  makefile: 'Makefile',
  markdown: 'Markdown',
  mdx: 'MDX',
  nix: 'Nix',
  'objective-c': 'Objective-C',
  ocaml: 'OCaml',
  perl: 'Perl',
  php: 'PHP',
  plaintext: 'Text',
  powershell: 'PowerShell',
  prisma: 'Prisma',
  properties: 'INI',
  proto: 'Protocol Buffer',
  python: 'Python',
  r: 'R',
  restructuredtext: 'ReStructuredText',
  ruby: 'Ruby',
  rust: 'Rust',
  sass: 'Sass',
  scala: 'Scala',
  scss: 'SCSS',
  shellscript: 'Bash',
  sql: 'SQL',
  svelte: 'Svelte',
  swift: 'Swift',
  terraform: 'Terraform',
  toml: 'TOML',
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript',
  vue: 'Vue.js',
  xml: 'XML',
  yaml: 'YAML',
  zig: 'Zig',
};

export function languageName(languageId: string | undefined): string | undefined {
  return languageId ? LANGUAGE_NAMES[languageId] : undefined;
}
