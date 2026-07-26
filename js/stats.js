import { getHistoryBenchmark, getModuleAnalytics, openSettingsDrawer, openStatsDrawer, renderPersonalAnalytics } from './analytics.js';
import { markBackupDone, renderLastBackupInfo } from './backup-reminder.js';
import { focusAudio, normalizeFocusSoundSettings, stopFocusSound, syncFocusSoundUi } from './audio.js';
import { $, $$, APP_VERSION, MOCK_MODULE_NAMES, SPEED_SCORE_TYPES, STORAGE_RECORDS, STORAGE_SETTINGS, TRACKING_CATEGORIES, escapeAttribute, escapeHTML, normalizeLapReviews, normalizeLaps, normalizeModuleResults, normalizeRecords, saveRecords, state, toNonNegativeInt, toPositiveInt, toScore } from './core.js';
import { normalizeExamCountdown, renderExamCountdown } from './exam.js';
import { formatAccuracy, formatClock, formatDuration, formatScore } from './format.js';
import { openMockReport, returnToTrainingPreviousStep } from './mock.js';
import { renderPrediction } from './predict.js';
import { getLapReviewCounts, openLapDetail, render } from './render.js';
import { getSectionDurationSnapshot, getSectionOrderSnapshot } from './sections.js';
import { getAccuracyTotals, getScoreAverage, hasAccuracy, recordLap, requestFinish, resetTimer, startOrPause, undoLap } from './timer.js';
import { showToast } from './ui.js';

function isEditableShortcutTarget(target) {
  return target?.closest?.('input,select,textarea,button,a,[contenteditable="true"]');
}

function runShortcutAction(action) {
  switch (action) {
    case 'toggle': startOrPause(); return '开始 / 暂停';
    case 'finish': requestFinish(); return state.status === 'idle' ? '' : '结束并复盘';
    case 'reset': resetTimer(true); return '重置';
    case 'lap': recordLap(); return '完成一题';
    case 'undoLap': undoLap(); return '撤销打点';
    case 'stats': openStatsDrawer(); return '数据复盘';
    case 'settings': openSettingsDrawer(); return '设置';
    case 'shortcutHelp': openSettingsDrawer('shortcuts'); return '快捷键说明';
    default: return '';
  }
}

function getShortcutAction(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return '';
  if (event.code === 'Space') return state.status === 'running' ? 'lap' : '';
  if (event.key === '?' || (event.shiftKey && event.code === 'Slash')) return 'shortcutHelp';
  const key = event.key.toLowerCase(), code = event.code;
  if (key === 's' || code === 'KeyS') return 'toggle';
  if (key === 'f' || code === 'KeyF') return state.status === 'idle' || state.elapsed < 1 ? '' : 'finish';
  if (key === 'r' || code === 'KeyR') return state.status === 'idle' ? '' : 'reset';
  if (key === 'u' || code === 'KeyU') return state.laps.length ? 'undoLap' : '';
  if (key === 'd' || code === 'KeyD') return 'stats';
  if (key === 'g' || code === 'KeyG') return 'settings';
  return '';
}

function handleGlobalShortcut(event) {
  if (event.repeat || state.settings.shortcuts === false || $('dialog[open]')) return;
  if (isEditableShortcutTarget(event.target)) return;
  const action = getShortcutAction(event);
  if (!action) return;
  event.preventDefault();
  const label = runShortcutAction(action);
  if (label && !['lap', 'undoLap'].includes(action)) showToast('快捷键：' + label);
}

function recordMatchesHistoryFilter(record, filter) {
  if (!filter) return true;
  const separator = filter.indexOf(':'), type = filter.slice(0, separator), value = filter.slice(separator + 1);
  if (type === 'difficulty') return record.difficulty === value;
  return true;
}

function renderStats() {
  const now = new Date(), todayKey = now.toDateString(), weekStart = new Date(now); weekStart.setHours(0,0,0,0); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  renderDataManagementSummary();
  const today = state.records.filter(r => new Date(r.endedAt).toDateString() === todayKey);
  const week = state.records.filter(r => new Date(r.endedAt) >= weekStart);
  const weekAccuracy = getAccuracyTotals(week);
  const weekScore = getScoreAverage(week.filter(r => SPEED_SCORE_TYPES.has(r.module)));
  $('#historyTabCount').textContent = state.records.length > 99 ? '99+' : String(state.records.length);
  $('#todayDuration').textContent = formatDuration(today.reduce((n,r)=>n+r.duration,0)); $('#weekCount').textContent = `${week.length} 次`; $('#weekDuration').textContent = formatDuration(week.reduce((n,r)=>n+r.duration,0)); $('#weekAccuracy').textContent = formatAccuracy(weekAccuracy.correct, weekAccuracy.questions); $('#weekScore').textContent = formatScore(weekScore);
  renderPersonalAnalytics(now);
  renderPrediction(now);
  const modules = TRACKING_CATEGORIES; $('#moduleStats').innerHTML = modules.map(name => {
    const analytics = getModuleAnalytics(state.records, name), directRows = state.records.filter(r => r.module === name), timedRows = analytics.rows.filter(row => Number.isFinite(row.duration) && row.duration > 0), avg = timedRows.length ? timedRows.reduce((n,r)=>n+r.duration,0)/timedRows.length : 0;
    const avgPerQuestion = analytics.pace || 0;
    const avgScore = getScoreAverage(directRows);
    const paperRows = directRows.filter(r => r.papers), paperText = paperRows.length ? ` / ${paperRows.reduce((n,r)=>n+r.papers,0)} 套` : '';
    const scoreText = avgScore !== null ? ` / 均分 ${formatScore(avgScore)}` : '';
    const accuracyText = analytics.accuracyQuestions ? ` / ${analytics.correct}/${analytics.accuracyQuestions} 正确 / 正确率 ${formatAccuracy(analytics.correct, analytics.accuracyQuestions)}` : '';
    return `<div class="module-row"><strong>${name}</strong><span>${analytics.rows.length ? (timedRows.length ? formatDuration(avg) : '已录入复盘') : '暂无记录'}${paperText}${scoreText}${avgPerQuestion ? ` / 题均 ${formatClock(avgPerQuestion).slice(3)}` : ''}${accuracyText}</span></div>`;
  }).join('');
  const historyFilter = $('#historyFilter')?.value || '';
  const filteredRecords = state.records.filter(record => recordMatchesHistoryFilter(record, historyFilter));
  $('#historyList').innerHTML = filteredRecords.length ? filteredRecords.slice(0,30).map(r => {
    const accuracyText = hasAccuracy(r) ? ` · 正确 ${r.correct}/${r.questions} · 正确率 ${formatAccuracy(r.correct, r.questions)}` : '';
    const scoreText = toScore(r.score) !== null ? ` · ${formatScore(toScore(r.score))}` : '';
    const lapCount = normalizeLaps(r.laps).length, reviewCounts = getLapReviewCounts(normalizeLapReviews(r.lapReviews, lapCount), lapCount);
    const reportLink = r.module === '行测模考' ? `<button class="lap-detail-button" data-mock-report-id="${escapeAttribute(r.id)}" type="button">查看模考报告</button>` : '';
    const lapLink = lapCount ? `<button class="lap-detail-button" data-lap-id="${escapeAttribute(r.id)}" type="button">${reviewCounts.reviewed ? `逐题复盘 ${reviewCounts.reviewed}/${lapCount} 题` : `开始 ${lapCount} 题逐题复盘`}</button>` : '';
    const tags = [r.source ? `<span class="record-tag source">来源：${escapeHTML(r.source)}</span>` : '', r.difficulty ? `<span class="record-tag difficulty">${r.difficulty}</span>` : ''].filter(Boolean).join('');
    const notePreview = r.note ? (r.note.length > 120 ? `${r.note.slice(0, 120)}…` : r.note) : '';
    const moduleResults = r.module === '行测模考' ? normalizeModuleResults(r.moduleResults) : [], reviewedModuleResults = moduleResults.filter(result => result.correct !== null), weakestModule = reviewedModuleResults.sort((a, b) => a.correct / a.questions - b.correct / b.questions)[0];
    const moduleReviewHtml = reviewedModuleResults.length ? `<span class="history-module-review">模块复盘 ${reviewedModuleResults.length}/${MOCK_MODULE_NAMES.length} 项${weakestModule ? ` · ${escapeHTML(weakestModule.module)} ${formatAccuracy(weakestModule.correct, weakestModule.questions)}` : ''}</span>` : '';
    const metaHtml = tags || notePreview || moduleReviewHtml ? `<span class="record-meta-tags">${tags}${moduleReviewHtml}</span>${notePreview ? `<span class="history-note">“${escapeHTML(notePreview)}”</span>` : ''}` : '';
    const benchmark = getHistoryBenchmark(r), benchmarkHtml = benchmark ? `<span class="history-benchmark">相对基准 · ${benchmark}</span>` : '';
    return `<div class="history-row" data-record-id="${escapeAttribute(r.id)}"><button class="history-edit-trigger" data-edit-record-id="${escapeAttribute(r.id)}" type="button" aria-label="修改${escapeAttribute(r.module)}记录"><span class="history-main"><strong>${escapeHTML(r.module)}</strong><span class="history-meta">${new Date(r.endedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}${r.papers ? ` · ${r.papers} 套` : ''}${scoreText}${r.questions ? ` · ${r.questions} 题 · 题均 ${formatClock(r.duration/r.questions).slice(3)}` : ''}${accuracyText}</span>${benchmarkHtml}${metaHtml}</span><span class="history-side"><strong class="history-duration">${formatClock(r.duration)}</strong><span>点击编辑</span></span></button><button class="delete-record" data-id="${escapeAttribute(r.id)}" type="button" aria-label="删除${escapeAttribute(r.module)}记录" title="删除记录">×</button>${reportLink || lapLink ? `<div class="history-record-actions">${reportLink}${lapLink}</div>` : ''}</div>`;
  }).join('') : `<div class="empty-state">${historyFilter ? '没有符合筛选条件的记录' : '完成一次训练后，记录会显示在这里'}</div>`;
  $$('.delete-record').forEach(btn => btn.addEventListener('click', () => {
    if (!confirm('确定删除这条训练记录吗？此操作无法撤销。')) return;
    const previousRecords = state.records;
    state.records = state.records.filter(r => r.id !== btn.dataset.id);
    if (!saveRecords()) { state.records = previousRecords; return; }
    renderStats();
  }));
  $$('.lap-detail-button').forEach(btn => btn.addEventListener('click', () => openLapDetail(btn.dataset.lapId)));
  $$('[data-mock-report-id]').forEach(btn => btn.addEventListener('click', () => openMockReport(btn.dataset.mockReportId)));
}

function applySettings() {
  document.body.classList.toggle('dark', state.settings.dark);
  const sizes = ['clamp(4.5rem,9vw,8rem)','clamp(5rem,11vw,9.5rem)','clamp(5.5rem,13vw,11rem)']; document.documentElement.style.setProperty('--timer-size', sizes[state.settings.fontSize]);
  $('#soundToggle').checked = state.settings.sound; $('#pacingToggle').checked = state.settings.pacing !== false; $('#shortcutsToggle').checked = state.settings.shortcuts !== false; $('#themeToggle').checked = state.settings.dark; $('#fontSizeRange').value = state.settings.fontSize; $('#warningRange').value = state.settings.warning;
  $('#fontSizeOutput').textContent = ['紧凑','标准','特大'][state.settings.fontSize]; $('#warningOutput').textContent = `最后 ${state.settings.warning < 60 ? state.settings.warning + ' 秒' : state.settings.warning / 60 + ' 分钟'}`;
  if (!normalizeFocusSoundSettings().enabled && focusAudio.playing) stopFocusSound(false);
  syncFocusSoundUi(); renderExamCountdown();
}

function buildSettingsSnapshot() {
  const sectionOrder = getSectionOrderSnapshot();
  const sectionDurations = getSectionDurationSnapshot();
  return {
    ...state.settings,
    sound: state.settings.sound !== false,
    pacing: state.settings.pacing !== false,
    shortcuts: state.settings.shortcuts !== false,
    focusSound: normalizeFocusSoundSettings(state.settings.focusSound),
    dark: Boolean(state.settings.dark),
    fontSize: Number.isFinite(Number(state.settings.fontSize)) ? Number(state.settings.fontSize) : 1,
    warning: Number.isFinite(Number(state.settings.warning)) ? Number(state.settings.warning) : 60,
    examCountdown: normalizeExamCountdown(state.settings.examCountdown),
    sectionOrder,
    customDurations: { ...(state.settings.customDurations || {}), section: sectionDurations }
  };
}

function buildExportData() {
  const settings = buildSettingsSnapshot(), records = normalizeRecords(state.records);
  return {
    version: 2,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    storageKeys: { settings: STORAGE_SETTINGS, records: STORAGE_RECORDS },
    settings,
    configuration: {
      sound: settings.sound,
      pacing: settings.pacing,
      shortcuts: settings.shortcuts,
      focusSound: settings.focusSound,
      dark: settings.dark,
      fontSize: settings.fontSize,
      warning: settings.warning,
      sectionOrder: settings.sectionOrder,
      sectionDurations: settings.customDurations.section
    },
    records,
    summary: { recordCount: records.length, sectionCount: settings.sectionOrder.length }
  };
}

function getDateStamp(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function renderDataManagementSummary() {
  const count = $('#dataRecordCount');
  if (count) count.textContent = `${state.records.length} 条`;
  renderLastBackupInfo();
}

function exportData() {
  const blob = new Blob([JSON.stringify(buildExportData(), null, 2)], { type: 'application/json' });
  downloadBlob(blob, `公考计时器完整备份-${getDateStamp()}.gktimer`);
  markBackupDone();
  showToast('完整备份已下载');
}

function formatExportDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function cancelTrainingMetaDialog() {
  if (state.pendingMeta?.previous) { returnToTrainingPreviousStep(); return; }
  state.pendingMeta = null; $('#trainingMetaDialog').close(); render(); showToast('已返回计时，当前训练尚未保存');
}

function buildRecordsCsv(records = normalizeRecords(state.records)) {
  const modeNames = { mock: '模考模式', section: '专项模式', single: '自由测速' };
  const headers = ['日期时间', '模式', '题型', '用时', '计划用时', '题数', '正确数', '正确率', '分数', '打点数', '来源', '难度', '备注'];
  const rows = records.map(record => {
    const questions = toPositiveInt(record.questions), correct = toNonNegativeInt(record.correct), score = toScore(record.score);
    return [
      formatExportDateTime(record.endedAt),
      modeNames[record.mode] || record.mode || '',
      record.module || '',
      Number.isFinite(record.duration) ? formatClock(record.duration) : '',
      Number.isFinite(record.planned) ? formatClock(record.planned) : '',
      questions ?? '',
      correct ?? '',
      questions && correct !== null ? formatAccuracy(correct, questions) : '',
      score !== null ? score : '',
      Array.isArray(record.laps) ? record.laps.length : 0,
      record.source || '',
      record.difficulty || '',
      record.note || ''
    ];
  });
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

function exportRecordsCsv() {
  const records = normalizeRecords(state.records);
  if (!records.length) { showToast('暂无训练记录可导出'); return; }
  const blob = new Blob([`\ufeff${buildRecordsCsv(records)}`], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `公考计时器训练记录-${getDateStamp()}.csv`);
  showToast('训练记录表已导出');
}

export { applySettings, buildExportData, buildRecordsCsv, buildSettingsSnapshot, cancelTrainingMetaDialog, exportData, exportRecordsCsv, formatExportDateTime, getDateStamp, handleGlobalShortcut, renderDataManagementSummary, renderStats };
