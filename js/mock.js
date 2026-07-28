import { APP_EVENTS, emitAppEvent } from './app-events.js';
import { $, $$, MOCK_PACING_QUESTION_COUNTS, PRESETS, escapeHTML, normalizeLaps, normalizeModuleResults, normalizeTrainingMeta, saveRecords, state, toNonNegativeInt, toScore } from './core.js';
import { formatAccuracy, formatClock, formatScore, formatShortClock } from './format.js';
import { openLapDetail } from './render.js';
import { getOrderedSectionPresets } from './sections.js';
import { finalizeSpeedSession, resumeSpeedReviewStep, saveSession } from './speed.js';
import { openCorrectInputDialog, resetTimer } from './timer.js';
import { showToast } from './ui.js';

function getMockModuleReviewPlan(laps = state.laps) {
  const values = normalizeLaps(laps), orderedPresets = getOrderedSectionPresets();
  let cursor = 0;
  return orderedPresets.map(preset => {
    const questions = MOCK_PACING_QUESTION_COUNTS[preset.name], moduleLaps = values.slice(cursor, cursor + questions);
    cursor += questions;
    return {
      module: preset.name,
      questions,
      planned: preset.seconds,
      duration: moduleLaps.length === questions ? Math.round(moduleLaps.reduce((sum, value) => sum + value, 0)) : null
    };
  });
}

function openMockModuleReview(result, options = {}) {
  const restored = options.pending || null;
  const editingRecord = restored?.editingRecordId ? state.records.find(item => item.id === restored.editingRecordId) : (options.record || null);
  state.pendingTimed = restored || { step: 'modules', result, modulePlan: result.modulePlanDraft || (editingRecord ? getMockReportRows(editingRecord) : getMockModuleReviewPlan()), editingRecordId: editingRecord?.id || null };
  const plan = state.pendingTimed.modulePlan;
  const dotted = plan.filter(item => item.duration !== null).length;
  const editing = Boolean(editingRecord);
  $('#mockModuleTitle').textContent = editing ? '修正模考模块数据' : '各模块做对多少题？';
  $('#mockModuleMessage').textContent = editing ? '修改后的正确数、总分和训练信息将更新原训练记录，并重新计算统计。' : '题量和时间目标取自当前专项配置。可只填写已核对的模块，完成逐题打点的模块会同时记录实际用时。';
  $('#mockModuleScoreWrap').classList.toggle('hidden', !editing); $('#mockModuleScore').value = editing && toScore(state.pendingTimed.result.score) !== null ? String(toScore(state.pendingTimed.result.score)) : '';
  $('#mockModuleSummary').innerHTML = `<span>${editing ? '当前总分' : '总分'} <strong>${formatScore(result.score)}</strong></span><span>已完整打点 <strong>${dotted}/${plan.length} 个模块</strong></span>`;
  $('#mockModuleList').innerHTML = plan.map(item => {
    const timing = item.duration === null ? `目标 ${formatShortClock(item.planned)} · 未完整打点` : `实际 ${formatShortClock(item.duration)} / 目标 ${formatShortClock(item.planned)}`;
    return `<label class="mock-module-row"><span><strong>${item.module}</strong><small>${item.questions} 题 · ${timing}</small></span><span class="mock-module-input"><input data-mock-module-correct="${item.module}" type="number" min="0" max="${item.questions}" step="1" inputmode="numeric" value="${item.correct ?? ''}" placeholder="正确数" aria-label="${item.module}正确数量"><em>/ ${item.questions}</em></span></label>`;
  }).join('');
  $('#skipMockModuleBtn').textContent = editing ? '取消修改' : '跳过模块复盘'; $('#saveMockModuleBtn').textContent = editing ? '下一步：训练信息' : '保存并继续';
  $('#mockModuleDialog').showModal();
  (editing ? $('#mockModuleScore') : $('#mockModuleList input')).focus();
}

function finishMockModuleReview(skip = false) {
  const pending = state.pendingTimed;
  if (!pending || pending.step !== 'modules') return;
  if (skip && pending.editingRecordId) { const recordId = pending.editingRecordId; state.pendingTimed = null; $('#mockModuleDialog').close(); openMockReport(recordId); return; }
  const moduleResults = skip ? [] : pending.modulePlan.map(item => {
    const input = $(`[data-mock-module-correct="${item.module}"]`), correct = toNonNegativeInt(input?.value);
    if (correct !== null && correct > item.questions) { input.focus(); showToast(`${item.module}正确数量需在 0 到 ${item.questions} 之间`); return null; }
    return { ...item, correct };
  });
  if (moduleResults.includes(null)) return;
  let score = pending.result.score;
  if (pending.editingRecordId) {
    score = toScore($('#mockModuleScore').value);
    if (score === null) { showToast('分数需在 0 到 100 之间'); $('#mockModuleScore').focus(); return; }
  }
  const reviewedPlan = pending.modulePlan.map(item => ({ ...item, correct: moduleResults.find(result => result.module === item.module)?.correct ?? item.correct ?? null }));
  const previous = { kind: 'modules', pending: { ...pending, modulePlan: reviewedPlan, result: { ...pending.result, score, moduleResults } } };
  state.pendingTimed = null; $('#mockModuleDialog').close();
  if (pending.editingRecordId) {
    const record = state.records.find(item => item.id === pending.editingRecordId); if (!record) return;
    const previousMeta = pending.result.metaDraft || normalizeTrainingMeta(record);
    state.pendingMeta = { context: 'mock-edit', recordId: record.id, result: { score, moduleResults }, previousMeta, previous };
    openTrainingMetaDialog('补充模考资料', state.pendingMeta.previousMeta, true); return;
  }
  beginTimedMeta({ ...pending.result, score, moduleResults }, previous);
}

function returnFromMockModuleReview() {
  const pending = state.pendingTimed;
  if (!pending || pending.step !== 'modules') return;
  if (pending.editingRecordId) {
    const recordId = pending.editingRecordId;
    state.pendingTimed = null; $('#mockModuleDialog').close(); openMockReport(recordId); return;
  }
  const modulePlan = pending.modulePlan.map(item => ({ ...item, correct: toNonNegativeInt($(`[data-mock-module-correct="${item.module}"]`)?.value) }));
  state.pendingMockModuleDraft = { ...pending, modulePlan, result: { ...pending.result, modulePlanDraft: modulePlan } };
  state.pendingTimed = null; $('#mockModuleDialog').close();
  openCorrectInputDialog(pending.result.questions, { papers: pending.result.papers, score: true, endedAt: pending.result.endedAt, initial: pending.result });
}

function beginTimedMeta(result, previous = null) {
  state.pendingMeta = { context: 'timed', result, previous };
  openTrainingMetaDialog(`${state.preset.name} · 训练复盘`, result.metaDraft, Boolean(previous));
}

function finalizeTimedSession(questions, papers, correct = null, score = null, meta = {}, moduleResults = [], endedAt = new Date().toISOString()) {
  const savedRecord = saveSession(questions, papers, correct, score, state.laps, meta, moduleResults, endedAt);
  if (!savedRecord) return;
  resetTimer(false);
  const accuracyText = questions && correct !== null ? `，正确率 ${formatAccuracy(correct, questions)}` : '';
  const scoreText = score !== null ? `，分数 ${formatScore(score)}` : '';
  const reviewedModuleCount = normalizeModuleResults(moduleResults).filter(result => result.correct !== null).length;
  const moduleText = reviewedModuleCount ? `，已复盘 ${reviewedModuleCount} 个模块` : '';
  showToast(`${papers ? `已保存：${papers} 套卷子` : '训练记录已保存'}${scoreText}${accuracyText}${moduleText}`);
  if (savedRecord?.module === '行测模考') openMockReport(savedRecord.id);
  else if (savedRecord?.laps.length) openLapDetail(savedRecord.id);
}

function getMockReportRows(record) {
  const savedResults = normalizeModuleResults(record.moduleResults), savedByModule = new Map(savedResults.map(result => [result.module, result]));
  const savedOrder = savedResults.map(result => result.module), fallbackOrder = getOrderedSectionPresets().map(preset => preset.name);
  const order = [...savedOrder, ...fallbackOrder.filter(name => !savedOrder.includes(name))];
  return order.map(module => {
    const saved = savedByModule.get(module), preset = PRESETS.section.find(item => item.name === module);
    return { module, questions: MOCK_PACING_QUESTION_COUNTS[module], correct: saved?.correct ?? null, duration: saved?.duration ?? null, planned: saved?.planned ?? preset?.seconds ?? null };
  });
}

function getMockReportInsights(record, rows) {
  const insights = [], reviewed = rows.filter(row => row.correct !== null), timed = rows.filter(row => row.duration !== null && row.planned);
  const priorScores = state.records.filter(item => item.id !== record.id && item.module === '行测模考').map(item => toScore(item.score)).filter(Number.isFinite);
  const score = toScore(record.score);
  if (score !== null && priorScores.length) {
    const average = priorScores.reduce((sum, value) => sum + value, 0) / priorScores.length, delta = score - average;
    insights.push(Math.abs(delta) < 1 ? '本次成绩接近个人历史均分。' : `本次成绩较个人历史均分${delta > 0 ? '高' : '低'} ${Math.abs(Math.round(delta * 10) / 10)} 分。`);
  }
  if (reviewed.length) {
    const weakest = [...reviewed].sort((a, b) => a.correct / a.questions - b.correct / b.questions)[0];
    insights.push(`优先复盘 ${weakest.module}，本次正确率 ${formatAccuracy(weakest.correct, weakest.questions)}。`);
  } else insights.push('尚未填写模块正确数，补充后可定位薄弱模块。');
  if (timed.length) {
    const behind = [...timed].sort((a, b) => (b.duration - b.planned) - (a.duration - a.planned))[0], delta = behind.duration - behind.planned;
    insights.push(delta > 0 ? `${behind.module} 比时间目标慢 ${formatShortClock(delta)}。` : '已完整打点的模块均未超过时间目标。');
  } else insights.push('完整逐题打点后，这里会显示各模块实际用时。');
  return insights;
}

function openMockReport(recordId) {
  const record = state.records.find(item => item.id === recordId);
  if (!record || record.module !== '行测模考') return;
  const rows = getMockReportRows(record), reviewed = rows.filter(row => row.correct !== null), timed = rows.filter(row => row.duration !== null), score = toScore(record.score);
  $('#mockReportTitle').textContent = `${new Date(record.endedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 行测模考结论`;
  $('#mockReportMessage').textContent = `本次用时 ${formatClock(record.duration)}${score !== null ? `，得分 ${formatScore(score)}` : ''}。`;
  $('#mockReportSummary').innerHTML = `<span><small>模考得分</small><strong>${score === null ? '暂无' : formatScore(score)}</strong></span><span><small>模块正确数</small><strong>${reviewed.length}/${rows.length}</strong></span><span><small>完整打点</small><strong>${timed.length}/${rows.length}</strong></span>`;
  $('#mockReportInsights').innerHTML = getMockReportInsights(record, rows).map(insight => `<p>${escapeHTML(insight)}</p>`).join('');
  $('#mockReportList').innerHTML = rows.map(row => {
    const accuracy = row.correct === null ? '待填写' : formatAccuracy(row.correct, row.questions);
    const accuracyMeta = row.correct === null ? `${row.questions} 题` : `${row.correct}/${row.questions} 题`;
    const delta = row.duration !== null && row.planned ? row.duration - row.planned : null;
    const timing = row.duration === null ? `目标 ${formatShortClock(row.planned)}` : `实际 ${formatShortClock(row.duration)}`;
    const timingMeta = delta === null ? '未完整打点' : (delta > 0 ? `慢 ${formatShortClock(delta)}` : `快 ${formatShortClock(Math.abs(delta))}`);
    return `<article class="mock-report-row${row.correct === null ? ' incomplete' : ''}"><div><strong>${escapeHTML(row.module)}</strong><small>${row.questions} 题</small></div><div><span>正确率</span><strong>${accuracy}</strong><small>${accuracyMeta}</small></div><div class="mock-report-timing${delta !== null && delta > 0 ? ' behind' : ''}"><span>用时</span><strong>${timing}</strong><small>${timingMeta}</small></div></article>`;
  }).join('');
  $('#editMockReportBtn').dataset.mockReportId = record.id;
  $('#openReportLapReviewBtn').dataset.lapId = record.id; $('#openReportLapReviewBtn').classList.toggle('hidden', !normalizeLaps(record.laps).length);
  const dialog = $('#mockReportDialog');
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  dialog.focus({ preventScroll: true });
}

function editMockReport(recordId) {
  const record = state.records.find(item => item.id === recordId); if (!record || record.module !== '行测模考') return;
  $('#mockReportDialog').close();
  openMockModuleReview({ score: toScore(record.score) }, { record });
}

function openReportLapReview(recordId) {
  $('#mockReportDialog').close();
  openLapDetail(recordId);
}

function resetTrainingMetaDialog() {
  $('#trainingSource').value = ''; $('#trainingNote').value = '';
  $$('#trainingMetaDialog [aria-pressed]').forEach(button => { button.classList.remove('selected'); button.setAttribute('aria-pressed', 'false'); });
}

function openTrainingMetaDialog(title, initialMeta = null, showBack = false) {
  resetTrainingMetaDialog(); $('#trainingMetaTitle').textContent = title;
  $('#backTrainingMetaBtn').classList.toggle('hidden', !showBack);
  if (initialMeta) {
    $('#trainingSource').value = initialMeta.source || ''; $('#trainingNote').value = initialMeta.note || '';
    const selected = initialMeta.difficulty ? $(`#difficultyChoices [data-difficulty="${initialMeta.difficulty}"]`) : null;
    if (selected) { selected.classList.add('selected'); selected.setAttribute('aria-pressed', 'true'); }
  }
  $('#trainingMetaDialog').showModal(); $('#trainingSource').focus();
}

function readTrainingMeta() {
  return normalizeTrainingMeta({
    source: $('#trainingSource').value,
    difficulty: $('#difficultyChoices [aria-pressed="true"]')?.dataset.difficulty || null,
    note: $('#trainingNote').value
  });
}

function finishTrainingMeta(skip = false) {
  const pending = state.pendingMeta; if (!pending) return;
  const meta = skip ? (pending.context === 'mock-edit' ? pending.previousMeta : normalizeTrainingMeta()) : readTrainingMeta();
  state.pendingMeta = null; $('#trainingMetaDialog').close();
  if (pending.context === 'timed') {
    const { questions, papers, correct, score, moduleResults = [], endedAt } = pending.result;
    finalizeTimedSession(questions, papers, correct, score, meta, moduleResults, endedAt);
  } else if (pending.context === 'speed') finalizeSpeedSession(pending.moduleName, meta);
  else if (pending.context === 'mock-edit') {
    const record = state.records.find(item => item.id === pending.recordId); if (!record) return;
    const previousRecord = { ...record, moduleResults: [...record.moduleResults] };
    record.score = pending.result.score; record.moduleResults = normalizeModuleResults(pending.result.moduleResults); Object.assign(record, meta, { updatedAt: new Date().toISOString() });
    if (!saveRecords()) { Object.assign(record, previousRecord); return; }
    emitAppEvent(APP_EVENTS.RENDER_STATS); showToast('模考报告已更新'); openMockReport(record.id);
  }
}

function returnToTrainingPreviousStep() {
  const pending = state.pendingMeta;
  if (!pending?.previous) return;
  const metaDraft = readTrainingMeta(), previous = pending.previous;
  $('#trainingMetaDialog').close();
  if (pending.context === 'speed') {
    state.pendingSpeed.metaDraft = metaDraft;
    state.pendingMeta = null;
    resumeSpeedReviewStep();
    return;
  }
  if (pending.context === 'timed') pending.result.metaDraft = metaDraft;
  if (pending.context === 'mock-edit') pending.previous.pending.result.metaDraft = metaDraft;
  state.pendingMeta = null;
  if (previous.kind === 'modules') {
    openMockModuleReview(previous.pending.result, { pending: previous.pending });
    return;
  }
  if (previous.kind === 'finish') {
    const result = pending.result;
    openCorrectInputDialog(result.questions, {
      papers: result.papers,
      score: result.score !== null,
      initial: result
    });
  }
}

export { beginTimedMeta, editMockReport, finishMockModuleReview, finishTrainingMeta, openMockModuleReview, openMockReport, openReportLapReview, openTrainingMetaDialog, returnFromMockModuleReview, returnToTrainingPreviousStep };
