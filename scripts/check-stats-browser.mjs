import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8765;
const DEBUG_PORT = 9223;
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || os.tmpdir();
const MIME_TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
});

await new Promise((resolve, reject) => server.listen(PORT, '127.0.0.1', resolve).once('error', reject));

const browserPath = findBrowser();
assert(browserPath, 'No supported Edge/Chrome executable found. Set BROWSER_PATH to run this check.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gongkao-stats-'));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`, `http://127.0.0.1:${PORT}/`
], { stdio: 'ignore' });

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let socket;

try {
  let pages;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      pages = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      if (pages.some(page => page.type === 'page' && page.url.includes(`:${PORT}`))) break;
    } catch {}
    await sleep(200);
  }
  const page = pages?.find(item => item.type === 'page' && item.url.includes(`:${PORT}`));
  assert(page, 'Browser did not open the stats test page');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let requestId = 0;
  const pending = new Map();
  const exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const call = (method, params = {}) => new Promise(resolve => {
    const id = ++requestId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
    return result.result.result.value;
  };
  const screenshot = async filename => {
    const result = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(SCREENSHOT_DIR, filename), Buffer.from(result.result.data, 'base64'));
  };

  await call('Runtime.enable');
  await call('Page.enable');
  for (let attempt = 0; attempt < 20 && !await evaluate('Boolean(window.state)'); attempt += 1) await sleep(100);
  await evaluate(`window.state.records = Array.from({length:75}, (_, index) => {
    const endedAt = new Date(Date.now() - index * 86400000);
    return { id:'record-' + index, mode:'section', module:'资料分析', duration:600, planned:1500, startedAt:new Date(endedAt - 600000).toISOString(), endedAt:endedAt.toISOString(), questions:10, correct:8, score:null, papers:null, laps:[], lapReviews:[], moduleResults:[], source:'', difficulty:index % 2 ? '正常' : '较难', note:'' };
  }); document.querySelector('#statsBtn').click();`);

  await evaluate(`document.querySelector('[data-stats-view="trend"]').click(); document.querySelector('[data-trend-period="all"]').click();`);
  const trend = await evaluate(`({ period:state.trendPeriod, summary:document.querySelector('#trendPeriodSummary').textContent, bars:document.querySelectorAll('#trendChart .trend-day').length })`);
  assert(trend.period === 'all' && trend.summary.startsWith('全部记录') && trend.bars === 75, 'All-time trend did not render all 75 daily buckets');

  await evaluate(`window.state.records.forEach((record, index) => { const endedAt = new Date(Date.now() - index * 5 * 86400000); record.endedAt = endedAt.toISOString(); record.startedAt = new Date(endedAt - 600000).toISOString(); }); document.querySelector('[data-trend-period="all"]').click();`);
  const groupedTrend = await evaluate(`({ summary:document.querySelector('#trendPeriodSummary').textContent, bars:document.querySelectorAll('#trendChart .trend-day').length })`);
  assert(groupedTrend.summary.includes('75 次训练') && groupedTrend.bars >= 12 && groupedTrend.bars <= 14, 'Long all-time trend was not grouped into monthly buckets');

  await evaluate(`document.querySelector('[data-stats-view="baseline"]').click(); document.querySelector('[data-baseline-period="30"]').click();`);
  const baseline = await evaluate(`({ period:state.baselinePeriod, trendPeriod:state.trendPeriod, summary:document.querySelector('#baselinePeriodSummary').textContent, cards:document.querySelectorAll('#baselineList .baseline-card').length })`);
  assert(baseline.period === 30 && baseline.trendPeriod === 'all' && baseline.summary.startsWith('最近 30 天') && baseline.cards > 0, 'Baseline period is not independent from trend period');

  await evaluate(`document.querySelector('[data-stats-view="history"]').click(); document.querySelector('[data-history-period="7"]').click();`);
  const recentHistory = await evaluate(`({ rows:document.querySelectorAll('#historyList .history-row').length, paginationHidden:document.querySelector('#historyPagination').classList.contains('hidden') })`);
  assert(recentHistory.rows === 2 && recentHistory.paginationHidden, 'Seven-day history filter is incorrect');
  await evaluate(`document.querySelector('[data-history-period="all"]').click();`);
  await evaluate(`window.state.records.forEach((record, index) => { record.module = index < 20 ? '\u8d44\u6599\u5206\u6790' : '\u8a00\u8bed\u7406\u89e3'; }); document.querySelector('[data-history-period="all"]').click(); { const moduleFilter = document.querySelector('#historyModuleFilter'); moduleFilter.value = '\u8d44\u6599\u5206\u6790'; moduleFilter.dispatchEvent(new Event('change')); }`);
  const moduleHistory = await evaluate(`({ rows:document.querySelectorAll('#historyList .history-row').length, page:state.historyPage, summary:document.querySelector('#historyRangeSummary').textContent, paginationHidden:document.querySelector('#historyPagination').classList.contains('hidden') })`);
  assert(moduleHistory.rows === 20 && moduleHistory.page === 1 && moduleHistory.summary.includes('\u8d44\u6599\u5206\u6790') && moduleHistory.paginationHidden, 'History module filter did not isolate the selected module');
  await screenshot('stats-history-module-desktop.png');
  await evaluate(`{ const moduleFilter = document.querySelector('#historyModuleFilter'); moduleFilter.value = ''; moduleFilter.dispatchEvent(new Event('change')); }`);
  let history = await evaluate(`({ rows:document.querySelectorAll('#historyList .history-row').length, page:state.historyPage, info:document.querySelector('#historyPageInfo').textContent, paginationHidden:document.querySelector('#historyPagination').classList.contains('hidden') })`);
  assert(history.rows === 30 && history.page === 1 && history.info.includes('1 / 3') && !history.paginationHidden, 'History page 1 pagination is incorrect');
  await evaluate(`document.querySelector('#historyNextBtn').click(); document.querySelector('#historyNextBtn').click();`);
  history = await evaluate(`({ rows:document.querySelectorAll('#historyList .history-row').length, page:state.historyPage, info:document.querySelector('#historyPageInfo').textContent, nextDisabled:document.querySelector('#historyNextBtn').disabled })`);
  assert(history.rows === 15 && history.page === 3 && history.info.includes('3 / 3') && history.nextDisabled, 'History page 3 pagination is incorrect');
  await screenshot('stats-history-desktop.png');

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`{ const moduleFilter = document.querySelector('#historyModuleFilter'); moduleFilter.value = '\u8d44\u6599\u5206\u6790'; moduleFilter.dispatchEvent(new Event('change')); }`);
  await sleep(100);
  const mobileHistory = await evaluate(`({ rows:document.querySelectorAll('#historyList .history-row').length, toolsFit:document.querySelector('.history-tools').scrollWidth <= document.querySelector('.history-tools').clientWidth })`);
  assert(mobileHistory.rows === 20 && mobileHistory.toolsFit, 'History module filter does not fit the mobile layout');
  await screenshot('stats-history-module-mobile.png');
  await evaluate(`document.querySelector('[data-stats-view="baseline"]').click(); document.querySelector('[data-baseline-period="all"]').click();`);
  await sleep(100);
  await screenshot('stats-baseline-mobile.png');

  await evaluate(`document.querySelector('[data-mode="section"]').click();`);
  const sectionPresets = await evaluate(`({ count:document.querySelectorAll('#presetList .preset-button').length, names:[...document.querySelectorAll('#presetList .preset-button strong')].map(item => item.textContent) })`);
  assert(sectionPresets.count === 10 && ['\u7533\u8bba\u6982\u62ec\u9898', '\u5206\u6790\u7406\u89e3\u9898', '\u63d0\u51fa\u5bf9\u7b56\u9898', '\u516c\u6587\u9898'].every(name => sectionPresets.names.includes(name)), 'Essay section presets are missing');
  await screenshot('essay-sections-mobile.png');
  await evaluate(`document.querySelector('#settingsBtn').click(); document.querySelector('[data-settings-view="pacing"]').click();`);
  const pacingSettings = await evaluate(`({ count:document.querySelectorAll('#sectionTimeGrid [data-section-time]').length, names:[...document.querySelectorAll('#sectionTimeGrid [data-section-time]')].map(item => item.dataset.sectionTime) })`);
  assert(pacingSettings.count === 10 && ['\u7533\u8bba\u6982\u62ec\u9898', '\u5206\u6790\u7406\u89e3\u9898', '\u63d0\u51fa\u5bf9\u7b56\u9898', '\u516c\u6587\u9898'].every(name => pacingSettings.names.includes(name)), 'Essay pacing settings are missing');
  await screenshot('essay-pacing-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  await screenshot('essay-pacing-desktop.png');
  await evaluate(`document.querySelector('#settingsDrawer .close-drawer').click();`);
  await screenshot('essay-sections-desktop.png');
  await evaluate(`document.querySelector('[data-mode="mock"]').click(); [...document.querySelectorAll('#presetList .preset-button')].find(button => button.textContent.includes('\u7533\u8bba\u56fd\u8003')).click();`);
  const essayPacing = await evaluate(`({ visible:!document.querySelector('#pacingStatus').classList.contains('hidden'), text:document.querySelector('#pacingStatusText').textContent })`);
  assert(essayPacing.visible && essayPacing.text.includes('\u7533\u8bba\u6982\u62ec\u9898'), 'Essay mock pacing did not start with the summary module');

  assert(!exceptions.length, `Browser exceptions: ${exceptions.join('; ')}`);
  console.log(`OK: trend daily=${trend.bars}, monthly=${groupedTrend.bars}, baseline=${baseline.cards} cards, module history=${moduleHistory.rows} rows, essay presets=${sectionPresets.count}, essay pacing=${pacingSettings.count}`);
  console.log(`Screenshots: ${path.join(SCREENSHOT_DIR, 'essay-sections-desktop.png')}, ${path.join(SCREENSHOT_DIR, 'essay-sections-mobile.png')}, ${path.join(SCREENSHOT_DIR, 'essay-pacing-desktop.png')}, ${path.join(SCREENSHOT_DIR, 'essay-pacing-mobile.png')}`);
} finally {
  socket?.close();
  browser.kill();
  server.close();
}
