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
    if (message.method === 'Runtime.exceptionThrown') { const details = message.params.exceptionDetails; exceptions.push(`${details.exception?.description || details.text} @ ${details.url || 'unknown'}:${details.lineNumber ?? 0}:${details.columnNumber ?? 0}`); }
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const call = (method, params = {}) => new Promise(resolve => {
    const id = ++requestId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description || result.result.exceptionDetails.text);
    return result.result.result.value;
  };
  const screenshot = async filename => {
    const result = await call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(SCREENSHOT_DIR, filename), Buffer.from(result.result.data, 'base64'));
  };
  const longPressReorder = async (sourceName, afterName) => {
    const points = await evaluate(`(() => {
      const source=document.querySelector('[data-pacing-plan-card][data-pacing-name="${sourceName}"] .pacing-plan-main');
      const target=document.querySelector('[data-pacing-plan-card][data-pacing-name="${afterName}"]');
      if (!source || !target) return null;
      const from=source.getBoundingClientRect(), to=target.getBoundingClientRect();
      return { from:{x:from.left + from.width / 2,y:from.top + from.height / 2}, to:{x:to.left + to.width / 2,y:to.bottom - 2} };
    })()`);
    assert(points, `Pacing reorder cards were not found: ${sourceName} -> ${afterName}`);
    await call('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:points.from.x, y:points.from.y, id:3 }] });
    await sleep(260);
    const activated = await evaluate(`({ preview:Boolean(document.querySelector('.pacing-reorder-preview')), label:document.querySelector('.pacing-position-indicator span')?.textContent || '' })`);
    assert(activated.preview && activated.label.includes('1'), `Pacing reorder did not show its initial position: ${JSON.stringify(activated)}`);
    await call('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:points.to.x, y:points.to.y, id:3 }] });
    await sleep(60);
    const predicted = await evaluate(`document.querySelector('.pacing-position-indicator span')?.textContent || ''`);
    assert(predicted.includes('2'), `Pacing reorder did not visualize the expected second position: ${predicted}`);
    await screenshot('pacing-reorder-position-mobile.png');
    await call('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    return predicted;
  };
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Page.reload', { ignoreCache: true });
  for (let attempt = 0; attempt < 20 && !await evaluate('Boolean(window.state)'); attempt += 1) await sleep(100);
  if (!await evaluate('Boolean(window.state)')) throw new Error(`Browser app did not initialize: ${exceptions.join('; ') || 'no runtime exception captured'}`);
  await evaluate(`window.state.records = Array.from({length:75}, (_, index) => {
    const endedAt = new Date(Date.now() - index * 86400000);
    return { id:'record-' + index, mode:'section', module:'资料分析', duration:600, planned:1500, startedAt:new Date(endedAt - 600000).toISOString(), endedAt:endedAt.toISOString(), questions:10, correct:8, score:null, laps:[], lapReviews:[], moduleResults:[], source:'', difficulty:index % 2 ? '正常' : '较难', note:'' };
  }); document.querySelector('#statsBtn').click();`);
  await evaluate(`document.querySelector('#addRecordBtn').click();`);
  const mockRecordChoices = await evaluate(`({ mode:document.querySelector('#createRecordMode').value, count:document.querySelectorAll('#createRecordModule option:not([value=""])').length, names:[...document.querySelectorAll('#createRecordModule option')].map(option => option.textContent) })`);
  assert(mockRecordChoices.mode === 'mock' && mockRecordChoices.count === 3 && mockRecordChoices.names.includes('\u7533\u8bba\u56fd\u8003') && mockRecordChoices.names.includes('\u884c\u6d4b\u6a21\u8003'), 'Mock custom record choices are incorrect');
  const mockRecordFields = await evaluate(`({ score:!document.querySelector('#createRecordScoreWrap').classList.contains('hidden'), total:!document.querySelector('#createRecordTotalScoreWrap').classList.contains('hidden'), questions:document.querySelector('#createRecordQuestionsWrap').classList.contains('hidden'), correct:document.querySelector('#createRecordCorrectWrap').classList.contains('hidden'), numericFieldCount:document.querySelectorAll('#recordCreateForm input[inputmode="numeric"], #recordEditForm input[inputmode="numeric"]').length })`);
  assert(mockRecordFields.score && mockRecordFields.total && mockRecordFields.questions && mockRecordFields.correct && mockRecordFields.numericFieldCount === 8, 'Mock custom record fields are incorrect');
  const sectionRecordChoices = await evaluate(`(() => { const select=document.querySelector('#createRecordMode'); select.value='section'; select.dispatchEvent(new Event('change')); return { count:document.querySelectorAll('#createRecordModule option:not([value=""])').length, writing:[...document.querySelectorAll('#createRecordModule option')].some(option => option.textContent === '\u5199\u4f5c') }; })()`);
  assert(sectionRecordChoices.count === 11 && sectionRecordChoices.writing, 'Section custom record choices are incorrect');
  const xingceRecordFields = await evaluate(`({ score:document.querySelector('#createRecordScoreWrap').classList.contains('hidden'), total:document.querySelector('#createRecordTotalScoreWrap').classList.contains('hidden'), questions:!document.querySelector('#createRecordQuestionsWrap').classList.contains('hidden'), correct:!document.querySelector('#createRecordCorrectWrap').classList.contains('hidden') })`);
  assert(xingceRecordFields.score && xingceRecordFields.total && xingceRecordFields.questions && xingceRecordFields.correct, 'Xingce custom record fields are incorrect');
  const essayRecordFields = await evaluate(`(() => { const select=document.querySelector('#createRecordModule'); select.value='\u5199\u4f5c'; select.dispatchEvent(new Event('change')); return { score:!document.querySelector('#createRecordScoreWrap').classList.contains('hidden'), total:!document.querySelector('#createRecordTotalScoreWrap').classList.contains('hidden'), questions:document.querySelector('#createRecordQuestionsWrap').classList.contains('hidden'), correct:document.querySelector('#createRecordCorrectWrap').classList.contains('hidden') }; })()`);
  assert(essayRecordFields.score && essayRecordFields.total && essayRecordFields.questions && essayRecordFields.correct, 'Essay custom record fields are incorrect');
  const singleRecordChoices = await evaluate(`(() => { const select=document.querySelector('#createRecordMode'); select.value='single'; select.dispatchEvent(new Event('change')); return { count:document.querySelectorAll('#createRecordModule option:not([value=""])').length, writing:[...document.querySelectorAll('#createRecordModule option')].some(option => option.textContent === '\u5199\u4f5c') }; })()`);
  assert(singleRecordChoices.count === 11 && singleRecordChoices.writing, 'Single custom record choices are incorrect');
  await evaluate(`document.querySelector('#cancelRecordCreateBtn').click();`);
  await evaluate(`window.__editorOriginalRecord = {...window.state.records[0]}; document.querySelector('[data-stats-view="history"]').click(); document.querySelector('#historyList [data-edit-record-id]').click();`);
  const xingceEditorFields = await evaluate(`({ total:document.querySelector('#editRecordTotalScoreWrap').classList.contains('hidden'), score:document.querySelector('#editRecordScoreWrap').classList.contains('hidden'), questions:!document.querySelector('#editRecordQuestionsWrap').classList.contains('hidden'), correct:!document.querySelector('#editRecordCorrectWrap').classList.contains('hidden') })`);
  assert(xingceEditorFields.total && xingceEditorFields.score && xingceEditorFields.questions && xingceEditorFields.correct, 'Xingce record editor fields are incorrect');
  await evaluate(`document.querySelector('#cancelRecordEditBtn').click(); window.state.records[0] = {...window.state.records[0], mode:'section', module:'写作', questions:10, correct:8, score:32, totalScore:50}; document.querySelector('#statsBtn').click(); document.querySelector('[data-stats-view="history"]').click(); document.querySelector('#historyList [data-edit-record-id]').click();`);
  const essayEditorFields = await evaluate(`({ total:!document.querySelector('#editRecordTotalScoreWrap').classList.contains('hidden'), score:!document.querySelector('#editRecordScoreWrap').classList.contains('hidden'), questions:document.querySelector('#editRecordQuestionsWrap').classList.contains('hidden'), correct:document.querySelector('#editRecordCorrectWrap').classList.contains('hidden'), totalValue:document.querySelector('#editRecordTotalScore').value, scoreValue:document.querySelector('#editRecordScore').value })`);
  assert(essayEditorFields.total && essayEditorFields.score && essayEditorFields.questions && essayEditorFields.correct && essayEditorFields.totalValue === '50' && essayEditorFields.scoreValue === '32', 'Essay record editor fields are incorrect');
  await evaluate(`document.querySelector('#cancelRecordEditBtn').click(); window.state.records[0] = window.__editorOriginalRecord; document.querySelector('#statsBtn').click();`);

  await evaluate(`window.__statsTestRecords = window.state.records; window.state.records = [
    ['申论国考', 68, 100, 2], ['申论省考', 72, 100, 8], ['概括题', 16, 20, 4], ['写作', 34, 50, 12]
  ].map(([module, score, totalScore, days], index) => { const endedAt = new Date(Date.now() - days * 86400000); return { id:'essay-' + index, mode:module.includes('申论') ? 'mock' : 'section', module, duration:3600, startedAt:new Date(endedAt - 3600000).toISOString(), endedAt:endedAt.toISOString(), questions:null, correct:null, score, totalScore, laps:[], lapReviews:[], moduleResults:[], source:'', difficulty:null, note:'' }; }); document.querySelector('[data-stats-view="predict"]').click(); document.querySelector('[data-predict-subject="essay"]').click();`);
  const essayPrediction = await evaluate(`({ title:document.querySelector('#predictTitle').textContent, score:document.querySelector('#predictHero .predict-score-card strong')?.textContent, rows:document.querySelectorAll('#predictList .predict-row').length, levelHidden:document.querySelector('#predictLevelSwitch').classList.contains('hidden'), targetHidden:document.querySelector('#predictTarget').classList.contains('hidden'), note:document.querySelector('#predictNote').textContent })`);
  assert(essayPrediction.title === '申论分数预测' && Number(essayPrediction.score) >= 68 && Number(essayPrediction.score) <= 72 && essayPrediction.rows === 4 && essayPrediction.levelHidden && essayPrediction.targetHidden && essayPrediction.note.includes('整套模考'), `Essay prediction view is incorrect: ${JSON.stringify(essayPrediction)}`);
  await evaluate(`document.querySelector('[data-predict-subject="xingce"]').click();`);
  const xingcePrediction = await evaluate(`({ title:document.querySelector('#predictTitle').textContent, levelHidden:document.querySelector('#predictLevelSwitch').classList.contains('hidden'), targetHidden:document.querySelector('#predictTarget').classList.contains('hidden') })`);
  assert(xingcePrediction.title === '行测分数预测' && !xingcePrediction.levelHidden && !xingcePrediction.targetHidden, 'Switching from essay prediction back to xingce did not restore xingce controls');
  await evaluate(`window.state.records = window.__statsTestRecords; document.querySelector('[data-stats-view="trend"]').click();`);

  await evaluate(`document.querySelector('[data-trend-period="all"]').click();`);
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
  const xingcePresets = await evaluate(`({ count:document.querySelectorAll('#presetList .preset-button').length, groups:document.querySelectorAll('#sectionGroupSwitch [data-section-group]').length, selected:document.querySelector('#sectionGroupSwitch [aria-pressed="true"]').dataset.sectionGroup, fits:document.querySelector('#presetArea').scrollWidth <= document.querySelector('#presetArea').clientWidth, names:[...document.querySelectorAll('#presetList .preset-button strong')].map(item => item.textContent) })`);
  assert(xingcePresets.count === 6 && xingcePresets.groups === 2 && xingcePresets.selected === 'xingce' && xingcePresets.fits && xingcePresets.names.includes('\u8d44\u6599\u5206\u6790'), 'Xingce section group is incorrect');
  await evaluate(`document.querySelector('[data-section-group="essay"]').click();`);
  const essayPresets = await evaluate(`({ count:document.querySelectorAll('#presetList .preset-button').length, selected:document.querySelector('#sectionGroupSwitch [aria-pressed="true"]').dataset.sectionGroup, fits:document.querySelector('#presetArea').scrollWidth <= document.querySelector('#presetArea').clientWidth, names:[...document.querySelectorAll('#presetList .preset-button strong')].map(item => item.textContent) })`);
  assert(essayPresets.count === 5 && essayPresets.selected === 'essay' && essayPresets.fits && ['\u6982\u62ec\u9898', '\u5206\u6790\u7406\u89e3\u9898', '\u63d0\u51fa\u5bf9\u7b56\u9898', '\u516c\u6587\u9898', '\u5199\u4f5c'].every(name => essayPresets.names.includes(name)), 'Essay section group is incorrect');
  const finishFields = await evaluate(`({ total:Boolean(document.querySelector('#totalScoreInputWrap')), scoreLabel:document.querySelector('#scoreInputLabel').textContent, questions:Boolean(document.querySelector('#questionInputWrap')), correct:Boolean(document.querySelector('#correctInputWrap')) })`);
  assert(finishFields.total && finishFields.scoreLabel === '\u672c\u6b21\u5206\u6570' && finishFields.questions && finishFields.correct, 'Essay finish dialog fields are incomplete');
  await screenshot('essay-sections-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  await evaluate(`document.querySelector('#statsDrawer .close-drawer')?.click(); document.querySelector('#settingsBtn').click(); document.querySelector('[data-settings-view="pacing"]').click();`);
  await sleep(350);
  const pacingSettings = await evaluate(`({ group:document.querySelector('#pacingGroupSwitch [aria-pressed="true"]').dataset.pacingGroup, catalog:document.querySelectorAll('#sectionTimeGrid [data-section-time]').length, plan:document.querySelectorAll('#pacingPlanList [data-pacing-plan-card]').length, names:[...document.querySelectorAll('#sectionTimeGrid [data-section-time]')].map(item => item.dataset.sectionTime) })`);
  assert(pacingSettings.group === 'xingce' && pacingSettings.catalog === 6 && pacingSettings.plan === 6 && pacingSettings.names.includes('\u8d44\u6599\u5206\u6790'), 'Xingce pacing builder is incorrect');
  await evaluate(`document.querySelector('[data-pacing-remove][data-pacing-name="\u5e38\u8bc6\u5224\u65ad"]').click();`);
  const removedXingce = await evaluate(`({ plan:document.querySelectorAll('#pacingPlanList [data-pacing-plan-card]').length, addEnabled:!document.querySelector('[data-pacing-add][data-pacing-name="\u5e38\u8bc6\u5224\u65ad"]').disabled })`);
  assert(removedXingce.plan === 5 && removedXingce.addEnabled, 'Removing an xingce pacing card failed');
  await evaluate(`document.querySelector('[data-pacing-add][data-pacing-name="\u5e38\u8bc6\u5224\u65ad"]').click();`);
  const addedXingce = await evaluate(`({ plan:document.querySelectorAll('#pacingPlanList [data-pacing-plan-card]').length, included:Boolean(document.querySelector('#pacingPlanList [data-pacing-name="\u5e38\u8bc6\u5224\u65ad"]')) })`);
  assert(addedXingce.plan === 6 && addedXingce.included, 'Adding an xingce pacing card with the plus button failed');
  await evaluate(`document.querySelector('[data-pacing-remove][data-pacing-name="\u5e38\u8bc6\u5224\u65ad"]').click();`);
  await evaluate(`document.querySelector('[data-pacing-group="essay"]').click();`);
  const essayPacingSettings = await evaluate(`({ group:document.querySelector('#pacingGroupSwitch [aria-pressed="true"]').dataset.pacingGroup, catalog:document.querySelectorAll('#sectionTimeGrid [data-section-time]').length, plan:document.querySelectorAll('#pacingPlanList [data-pacing-plan-card]').length })`);
  assert(essayPacingSettings.group === 'essay' && essayPacingSettings.catalog === 5 && essayPacingSettings.plan === 5, 'Essay pacing builder is incorrect');
  await evaluate(`document.querySelector('[data-pacing-remove][data-pacing-name="\u6982\u62ec\u9898"]').click();`);
  await evaluate(`document.querySelector('[data-pacing-add][data-pacing-name="\u6982\u62ec\u9898"]').click();`);
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(100);
  const predictedPosition = await longPressReorder('\u5206\u6790\u7406\u89e3\u9898', '\u63d0\u51fa\u5bf9\u7b56\u9898');
  const essayPlan = await evaluate(`({ plan:document.querySelectorAll('#pacingPlanList [data-pacing-plan-card]').length, order:[...document.querySelectorAll('#pacingPlanList [data-pacing-plan-card]')].map(item => item.dataset.pacingName), fits:document.querySelector('#pacingPlanZone').scrollWidth <= document.querySelector('#pacingPlanZone').clientWidth && document.querySelector('#sectionTimeGrid').scrollWidth <= document.querySelector('#sectionTimeGrid').clientWidth })`);
  assert(essayPlan.plan === 5 && essayPlan.order[0] === '\u63d0\u51fa\u5bf9\u7b56\u9898' && essayPlan.order.includes('\u6982\u62ec\u9898') && essayPlan.order.includes('\u5199\u4f5c') && essayPlan.fits && predictedPosition.includes('2'), `Essay pacing add/reorder failed or overflowed the mobile layout: ${JSON.stringify(essayPlan)}`);
  await evaluate(`document.querySelector('[data-pacing-group="xingce"]').click();`);
  const retainedXingcePlan = await evaluate(`({ plan:document.querySelectorAll('#pacingPlanList [data-pacing-plan-card]').length, removed:!document.querySelector('#pacingPlanList [data-pacing-name="\u5e38\u8bc6\u5224\u65ad"]'), addEnabled:!document.querySelector('[data-pacing-add][data-pacing-name="\u5e38\u8bc6\u5224\u65ad"]').disabled })`);
  assert(retainedXingcePlan.plan === 5 && retainedXingcePlan.removed && retainedXingcePlan.addEnabled, 'Xingce and essay pacing plans did not remain independent');
  await evaluate(`document.querySelector('[data-pacing-group="essay"]').click();`);
  await screenshot('essay-pacing-mobile.png');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
  await screenshot('essay-pacing-desktop.png');
  await evaluate(`document.querySelector('#settingsDrawer .close-drawer').click();`);
  await screenshot('essay-sections-desktop.png');
  await call('Page.reload', { ignoreCache: true });
  for (let attempt = 0; attempt < 50 && !await evaluate('Boolean(window.state)'); attempt += 1) await sleep(100);
  assert(await evaluate('Boolean(window.state)'), `Browser app did not initialize after pacing reload: ${exceptions.join('; ') || 'no runtime exception captured'}`);
  const persistedPlans = await evaluate(`({ xingce:state.settings.pacingPlans.xingce, essay:state.settings.pacingPlans.essay })`);
  assert(persistedPlans.xingce.length === 5 && !persistedPlans.xingce.includes('\u5e38\u8bc6\u5224\u65ad') && persistedPlans.essay[0] === '\u63d0\u51fa\u5bf9\u7b56\u9898', 'Pacing plans were not restored after reload');
  await evaluate(`document.querySelector('[data-mode="mock"]').click(); [...document.querySelectorAll('#presetList .preset-button')].find(button => button.textContent.includes('\u7533\u8bba\u56fd\u8003')).click();`);
  const essayPacing = await evaluate(`({ visible:!document.querySelector('#pacingStatus').classList.contains('hidden'), text:document.querySelector('#pacingStatusText').textContent })`);
  assert(essayPacing.visible && essayPacing.text.includes('\u63d0\u51fa\u5bf9\u7b56\u9898'), 'Essay mock pacing did not follow the configured order');

  assert(!exceptions.length, `Browser exceptions: ${exceptions.join('; ')}`);
  console.log(`OK: trend daily=${trend.bars}, monthly=${groupedTrend.bars}, baseline=${baseline.cards} cards, module history=${moduleHistory.rows} rows, xingce presets=${xingcePresets.count}, essay presets=${essayPresets.count}, essay plan=${essayPlan.plan}`);
  console.log(`Screenshots: ${path.join(SCREENSHOT_DIR, 'essay-sections-desktop.png')}, ${path.join(SCREENSHOT_DIR, 'essay-sections-mobile.png')}, ${path.join(SCREENSHOT_DIR, 'essay-pacing-desktop.png')}, ${path.join(SCREENSHOT_DIR, 'essay-pacing-mobile.png')}, ${path.join(SCREENSHOT_DIR, 'pacing-reorder-position-mobile.png')}`);
} finally {
  socket?.close();
  browser.kill();
  server.close();
}
