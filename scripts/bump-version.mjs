#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CORE = path.join(ROOT, 'js', 'core.js');
const next = process.argv[2];

if (!/^v\d+\.\d+\.\d+$/.test(next || '')) {
  console.error('Usage: node scripts/bump-version.mjs v<major>.<minor>.<patch>');
  process.exit(1);
}

const coreSource = fs.readFileSync(CORE, 'utf8');
const match = coreSource.match(/const APP_VERSION = '(v\d+\.\d+\.\d+)'/);
if (!match) {
  console.error('APP_VERSION was not found in js/core.js');
  process.exit(1);
}

const current = match[1];
if (current === next) {
  console.log(`Version is already ${next}`);
  process.exit(0);
}

const updates = [
  {
    file: 'js/core.js',
    from: `const APP_VERSION = '${current}';`,
    to: `const APP_VERSION = '${next}';`,
    expected: 1
  },
  {
    file: 'sw.js',
    from: `const CACHE_NAME = \`${'${CACHE_PREFIX}'}${current}\`;`,
    to: `const CACHE_NAME = \`${'${CACHE_PREFIX}'}${next}\`;`,
    expected: 1
  },
  {
    file: 'index.html',
    from: `<span class="version-badge" title="当前版本">${current}</span>`,
    to: `<span class="version-badge" title="当前版本">${next}</span>`,
    expected: 1
  },
  {
    file: 'index.html',
    from: `src="js/main.js?v=${current}"`,
    to: `src="js/main.js?v=${next}"`,
    expected: 1
  },
  {
    file: 'README.md',
    from: `当前版本：${current}`,
    to: `当前版本：${next}`,
    expected: 2
  }
];

const prepared = new Map();
for (const update of updates) {
  const existing = prepared.get(update.file);
  const fullPath = existing?.fullPath || path.join(ROOT, update.file);
  const source = existing?.source || fs.readFileSync(fullPath, 'utf8');
  const count = source.split(update.from).length - 1;
  if (count !== update.expected) {
    throw new Error(`${update.file}: expected ${update.expected} version marker(s), found ${count}`);
  }
  prepared.set(update.file, { fullPath, source: source.replaceAll(update.from, update.to), count: (existing?.count || 0) + count });
}

for (const [file, update] of prepared) {
  fs.writeFileSync(update.fullPath, update.source);
  console.log(`${file}: ${current} -> ${next} (${update.count})`);
}

console.log(`Version updated from ${current} to ${next}`);
