#!/usr/bin/env node
// 发版脚本：一次性同步所有文件中的版本号。
// 用法：node scripts/bump-version.mjs v2.21.0
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CORE = path.join(ROOT, 'js', 'core.js');

const next = process.argv[2];
if (!/^v\d+\.\d+\.\d+$/.test(next || '')) {
  console.error('用法：node scripts/bump-version.mjs v<主>.<次>.<修订>   例如 v2.21.0');
  process.exit(1);
}

const coreSource = fs.readFileSync(CORE, 'utf8');
const match = coreSource.match(/const APP_VERSION = '(v\d+\.\d+\.\d+)'/);
if (!match) { console.error('未能在 js/core.js 中找到 APP_VERSION'); process.exit(1); }
const current = match[1];
if (current === next) { console.log(`版本已是 ${next}，无需修改`); process.exit(0); }

const FILES = ['js/core.js', 'sw.js', 'index.html', 'README.md'];
let total = 0;
for (const file of FILES) {
  const fullPath = path.join(ROOT, file);
  const source = fs.readFileSync(fullPath, 'utf8');
  const count = source.split(current).length - 1;
  if (!count) { console.warn(`警告：${file} 中未找到 ${current}`); continue; }
  fs.writeFileSync(fullPath, source.split(current).join(next));
  console.log(`${file}：${current} -> ${next}（${count} 处）`);
  total += count;
}
console.log(`完成：${current} -> ${next}，共更新 ${total} 处。`);
console.log('提醒：sw.js 缓存名已更新，部署后用户端会自动清理旧缓存。');
