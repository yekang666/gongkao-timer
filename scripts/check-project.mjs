import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const moduleFiles = fs.readdirSync(JS_DIR).filter(file => file.endsWith('.js')).sort();
const graph = new Map(moduleFiles.map(file => [file, []]));

for (const file of moduleFiles) {
  const source = read(`js/${file}`);
  for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
    const dependency = match[1];
    assert(graph.has(dependency), `js/${file} imports missing module ${dependency}`);
    if (graph.has(dependency)) graph.get(file).push(dependency);
  }
}

let nextIndex = 0;
const stack = [];
const onStack = new Set();
const indexes = new Map();
const lowLinks = new Map();
const cycles = [];

function visit(moduleName) {
  indexes.set(moduleName, nextIndex);
  lowLinks.set(moduleName, nextIndex);
  nextIndex += 1;
  stack.push(moduleName);
  onStack.add(moduleName);

  for (const dependency of graph.get(moduleName)) {
    if (!indexes.has(dependency)) {
      visit(dependency);
      lowLinks.set(moduleName, Math.min(lowLinks.get(moduleName), lowLinks.get(dependency)));
    } else if (onStack.has(dependency)) {
      lowLinks.set(moduleName, Math.min(lowLinks.get(moduleName), indexes.get(dependency)));
    }
  }

  if (lowLinks.get(moduleName) !== indexes.get(moduleName)) return;
  const component = [];
  let current;
  do {
    current = stack.pop();
    onStack.delete(current);
    component.push(current);
  } while (current !== moduleName);
  if (component.length > 1 || graph.get(component[0]).includes(component[0])) cycles.push(component.sort());
}

moduleFiles.forEach(file => { if (!indexes.has(file)) visit(file); });
assert(!cycles.length, `circular module dependencies: ${cycles.map(cycle => cycle.join(' -> ')).join('; ')}`);

const serviceWorker = read('sw.js');
const moduleListMatch = serviceWorker.match(/const APP_MODULES = \[([^\]]+)\]/);
const cachedModules = moduleListMatch ? [...moduleListMatch[1].matchAll(/'([^']+)'/g)].map(match => `${match[1]}.js`).sort() : [];
assert(JSON.stringify(cachedModules) === JSON.stringify(moduleFiles), 'sw.js APP_MODULES must contain every js module exactly once');

const analytics = read('js/analytics.js');
const render = read('js/render.js');
assert(analytics.includes('escapeHTML(ranked[0])'), 'most common custom reason must be HTML-escaped');
assert(analytics.includes('escapeHTML(reason)'), 'custom reason trend labels must be HTML-escaped');
assert(!analytics.includes('<strong>${ranked[0]}</strong>'), 'unsafe custom reason interpolation found in analytics.js');
assert(!analytics.includes('<span>${reason}</span>'), 'unsafe custom reason label interpolation found in analytics.js');
assert(render.includes('escapeHTML(reasonSummary)'), 'lap reason summary must be HTML-escaped');
assert(!render.includes('错因：${reasonSummary}'), 'unsafe reason summary interpolation found in render.js');

const html = read('index.html');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
assert(!duplicateIds.length, `duplicate HTML ids: ${duplicateIds.join(', ')}`);

const knownIds = new Set(ids);
for (const file of moduleFiles) {
  const source = read(`js/${file}`);
  for (const match of source.matchAll(/\$\(['"]#([A-Za-z][\w:-]*)['"]\)/g)) {
    assert(knownIds.has(match[1]), `js/${file} references missing #${match[1]}`);
  }
}

const versionFiles = ['js/core.js', 'sw.js', 'index.html', 'README.md'];
const versions = versionFiles.map(file => [...new Set([...read(file).matchAll(/v\d+\.\d+\.\d+/g)].map(match => match[0]))]);
assert(versions.every(values => values.length === 1 && values[0] === versions[0][0]), `version mismatch: ${versionFiles.map((file, index) => `${file}=${versions[index].join('|') || 'missing'}`).join(', ')}`);

if (failures.length) {
  failures.forEach(failure => console.error(`FAIL: ${failure}`));
  process.exit(1);
}

const edgeCount = [...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0);
console.log(`OK: ${moduleFiles.length} modules, ${edgeCount} dependencies, 0 cycles, ${ids.length} HTML ids`);
