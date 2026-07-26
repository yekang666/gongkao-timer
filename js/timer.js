import { playBeep, showTimeUpNotice, stopAlertKeepAlive } from './audio.js';
import { $, $$, MOCK_PACING_QUESTION_COUNTS, PRESETS, SECTION_QUESTION_COUNTS, clearActiveSession, persistActiveSession, state, toNonNegativeInt, toPositiveInt, toScore } from './core.js';
import { formatClock, formatDuration, formatShortClock } from './format.js';
import { beginTimedMeta, openMockModuleReview } from './mock.js';
import { syncMobilePipSource, syncNativeVideoTime, updatePip } from './pip.js';
import { render } from './render.js';
import { getOrderedSectionPresets } from './sections.js';
import { finishSpeedSession } from './speed.js';
import { appConfirm, resetFinishDialog, showToast, stopInterval } from './ui.js';

function hasAccuracy(record) {
  return toPositiveInt(record.questions) && toNonNegativeInt(record.correct) !== null;
}
function getAccuracyTotals(records) {
  return records.filter(hasAccuracy).reduce((totals, record) => {
    totals.questions += toPositiveInt(record.questions); totals.correct += toNonNegativeInt(record.correct); return totals;
  }, { questions: 0, correct: 0 });
}
function getScoreAverage(records) {
  const scores = records.map(record => toScore(record.score)).filter(Number.isFinite);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}

function renderPresets() {
  const list = $('#presetList'); list.innerHTML = '';
  if (state.mode === 'single') { $('#presetArea').classList.add('hidden'); return; }
  $('#presetArea').classList.remove('hidden');
  PRESETS[state.mode].forEach(preset => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'preset-button';
    if (state.preset.name === preset.name) button.classList.add('active');
    button.innerHTML = `<strong>${preset.name}</strong><span>${preset.seconds / 60} 分钟</span>`;
    button.addEventListener('click', () => selectPreset(preset)); list.appendChild(button);
  });
}

function selectPreset(preset) {
  if (state.status === 'running') return;
  if (state.preset === preset) return;
  if (state.elapsed >= 1 && !appConfirm('切换题型会清空当前未保存的计时和打点，确定继续吗？')) return;
  state.preset = preset; state.duration = preset.seconds; resetTimer(false); renderPresets();
}

function setMode(mode) {
  if (mode === state.mode) return;
  if (state.elapsed >= 1 && !appConfirm('切换模式会清空当前未保存的训练，确定继续吗？')) return;
  stopInterval(); state.mode = mode; state.preset = PRESETS[mode][0]; state.duration = state.preset.seconds;
  resetTimer(false);
  $$('.mode-tab').forEach(tab => { const active = tab.dataset.mode === mode; tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active)); });
  $('#timerHint').textContent = mode === 'single'
    ? '每完成一题点击计时数字、打点按钮或按空格，自动记录逐题用时。'
    : mode === 'section' ? '按专项节奏完成，每做完一题可打点记录逐题用时。' : '按正式考试节奏完成，每做完一题可打点记录逐题用时。';
  renderPresets(); syncMobilePipSource(true);
}

function startOrPause() {
  if (state.status === 'running') { pauseTimer(); $('#startBtn').blur(); return; }
  if (state.status === 'finished') resetTimer(false);
  state.status = 'running'; state.autoFinished = false; state.pendingMockModuleDraft = null;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.tickBase = { at: Date.now(), remaining: state.remaining, elapsed: state.elapsed };
  state.interval = setInterval(tick, 200); tick(); persistActiveSession(true); render(); syncNativeVideoTime(true); $('#startBtn').blur();
}

function pauseTimer() {
  tick(); stopInterval(); state.status = 'paused'; persistActiveSession(true); render(); syncNativeVideoTime(true);
}

function tick(skipPacing = false) {
  if (state.status !== 'running') return;
  const delta = Math.max(0, state.elapsed - state.tickBase.elapsed, (Date.now() - state.tickBase.at) / 1000);
  state.elapsed = state.tickBase.elapsed + delta;
  if (state.mode === 'single') state.remaining = 0;
  else {
    const rawRemaining = state.tickBase.remaining - delta;
    state.remaining = Math.max(0, rawRemaining);
    if (rawRemaining <= 0 && !state.autoFinished) { state.autoFinished = true; if (state.settings.sound) playBeep(); showTimeUpNotice(); syncMobilePipSource(true); }
  }
  if (!skipPacing) checkMockPacing(); persistActiveSession(); render(); updatePip();
}

function resetTimer(confirmNeeded = true) {
  if (confirmNeeded && state.elapsed >= 1 && !appConfirm('确定重置本轮计时吗？未结束的记录不会保存。')) return;
  stopInterval(); stopAlertKeepAlive(); clearActiveSession(); state.remaining = state.duration; state.elapsed = 0; state.startedAt = null; state.status = 'idle'; state.autoFinished = false; state.laps = []; state.lastLapElapsed = 0; state.pacingNotified = []; state.pendingMockModuleDraft = null; render(); updatePip(); syncMobilePipSource(true);
}

function recordLap() {
  if (state.status !== 'running') return;
  tick(true);
  const lapDuration = state.elapsed - state.lastLapElapsed;
  if (lapDuration < .25) { showToast('打点间隔太短，请完成下一题后再记录'); return; }
  state.laps.push(lapDuration); state.lastLapElapsed = state.elapsed;
  checkMockPacing();
  const number = state.laps.length;
  $('#lapBtn').classList.remove('lap-pulse'); requestAnimationFrame(() => $('#lapBtn').classList.add('lap-pulse'));
  if (navigator.vibrate) navigator.vibrate(25);
  persistActiveSession(true); render(); showToast(`第 ${number} 题已打点 · ${formatClock(lapDuration).slice(3)}`);
}

function undoLap() {
  if (!state.laps.length) return;
  const removed = state.laps.pop(); state.lastLapElapsed = state.laps.reduce((sum, value) => sum + value, 0);
  persistActiveSession(true); render(); $('#undoLapBtn').blur(); showToast(`已撤销上一题（${formatClock(removed).slice(3)}）`);
}

function renderLapPanel() {
  const count = state.laps.length;
  const completedDuration = state.laps.reduce((sum, value) => sum + value, 0);
  const currentDuration = Math.max(0, state.elapsed - state.lastLapElapsed);
  $('#lapCount').textContent = `${count} 题`;
  $('#currentLapTime').textContent = formatClock(currentDuration).slice(3);
  $('#lapAverageTime').textContent = count ? formatClock(completedDuration / count).slice(3) : '暂无';
  $('#lapBtn').disabled = state.status !== 'running';
  $('#undoLapBtn').disabled = !count;
  $('#timerDisplay').classList.toggle('lap-target', state.status === 'running');
  $('#timerDisplay').title = state.status === 'running' ? '点击记录完成一题' : '';
  $('#timerDisplay').tabIndex = state.status === 'running' ? 0 : -1;
  $('#timerDisplay').setAttribute('aria-label', state.status === 'running' ? `计时 ${$('#timerDisplay').textContent}，点击记录完成一题` : `计时 ${$('#timerDisplay').textContent}`);
}

function isMockPacingActive() {
  return state.settings.pacing !== false && state.mode === 'mock' && state.preset.name === '行测模考';
}

function getMockPacingPlan() {
  const pacingPresets = getOrderedSectionPresets(), configuredTotal = pacingPresets.reduce((sum, preset) => sum + preset.seconds, 0);
  if (!configuredTotal || state.duration <= 0) return [];
  let configuredElapsed = 0, questionTotal = 0;
  return pacingPresets.map((preset, index) => {
    configuredElapsed += preset.seconds; questionTotal += MOCK_PACING_QUESTION_COUNTS[preset.name] || 0;
    return { index, module: preset.name, at: state.duration * configuredElapsed / configuredTotal, questions: questionTotal, nextModule: pacingPresets[index + 1]?.name || null };
  }).slice(0, -1);
}

function checkMockPacing() {
  if (!isMockPacingActive() || !state.laps.length) return;
  const due = getMockPacingPlan().filter(checkpoint => state.elapsed >= checkpoint.at && !state.pacingNotified.includes(checkpoint.index));
  if (!due.length) return;
  due.forEach(checkpoint => state.pacingNotified.push(checkpoint.index));
  const checkpoint = due[due.length - 1], completed = state.laps.length;
  if (completed < checkpoint.questions) {
    showToast(`节奏提醒：计划应完成 ${checkpoint.questions} 题，当前 ${completed} 题，落后 ${checkpoint.questions - completed} 题`, 'warning');
  }
}

function renderPacingStatus() {
  const status = $('#pacingStatus');
  if (!isMockPacingActive()) { status.classList.add('hidden'); return; }
  const plan = getMockPacingPlan(), next = plan.find(checkpoint => state.elapsed < checkpoint.at);
  status.classList.remove('hidden');
  if (next) {
    const trackingHint = state.laps.length ? `当前 ${state.laps.length} 题` : '打点后判断是否落后';
    $('#pacingStatusText').textContent = `${formatShortClock(next.at)} 前完成 ${next.module} · 累计 ${next.questions} 题 · ${trackingHint}`;
  } else {
    $('#pacingStatusText').textContent = `已进入最后模块 · 当前打点 ${state.laps.length} 题`;
  }
}

function requestFinish() {
  if (state.elapsed < 1) return;
  if (state.mode === 'single') { finishSpeedSession(); return; }
  const endedAt = new Date().toISOString();
  pauseTimer();
  const lapQuestions = state.laps.length || null;
  if (state.mode === 'mock') { openCorrectInputDialog(lapQuestions, { papers: 1, score: true, endedAt }); return; }
  if (state.preset.name === '数量关系' && !lapQuestions) { openQuantityChoiceDialog(endedAt); return; }
  openCorrectInputDialog(lapQuestions || SECTION_QUESTION_COUNTS[state.preset.name] || null, { endedAt });
}

function confirmFinish() {
  if (state.status === 'finished' && state.autoFinished) { $('#finishDialog').close(); resetFinishDialog(); return; }
  if (state.pendingTimed?.step === 'correct') saveTimedCorrectSession();
}

function openQuantityChoiceDialog(endedAt = new Date().toISOString()) {
  state.pendingTimed = { step: 'quantity', endedAt };
  $('#dialogTitle').textContent = '选择数量关系题量';
  $('#dialogMessage').textContent = `本次训练 ${formatDuration(state.elapsed)}，请选择本组数量关系题量。`;
  $('#scoreInputWrap').classList.add('hidden'); $('#questionInputWrap').classList.add('hidden'); $('#correctInputWrap').classList.add('hidden'); $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').classList.add('hidden');
  $('#quantityChoiceWrap').classList.remove('hidden'); $('#finishDialog').showModal();
}

function saveQuantitySession(questions) {
  const endedAt = state.pendingTimed?.endedAt;
  $('#finishDialog').close(); resetFinishDialog(); openCorrectInputDialog(questions, { endedAt });
}

function openCorrectInputDialog(questions, options = {}) {
  if (!questions && !options.editableQuestions && !options.score) { beginTimedMeta({ questions: null, papers: null, correct: null, score: null, endedAt: options.endedAt || new Date().toISOString() }); return; }
  state.pendingTimed = { step: 'correct', questions, papers: options.papers ?? null, editableQuestions: Boolean(options.editableQuestions), score: Boolean(options.score), endedAt: options.endedAt || options.initial?.endedAt || new Date().toISOString(), metaDraft: options.initial?.metaDraft || null };
  $('#dialogTitle').textContent = options.score ? '填写本次分数' : (options.editableQuestions ? '填写本次正确率' : '填写正确数量');
  $('#dialogMessage').textContent = options.score ? `本次${state.preset.name} ${formatDuration(state.elapsed)}，请输入本次得分。` : (options.editableQuestions ? `本次${state.preset.name} ${formatDuration(state.elapsed)}，请输入完成题数和正确数量。` : `本次共 ${questions} 题，请输入做对的题数。`);
  const initial = options.initial || {};
  $('#finishScore').value = initial.score ?? '';
  $('#finishQuestionCount').value = initial.questions ?? (questions ? String(questions) : '');
  $('#finishCorrectCount').max = questions ? String(questions) : '';
  $('#finishCorrectCount').value = initial.correct ?? (questions ? String(questions) : '');
  $('#scoreInputWrap').classList.toggle('hidden', !options.score);
  $('#questionInputWrap').classList.toggle('hidden', !options.editableQuestions);
  $('#quantityChoiceWrap').classList.add('hidden'); $('#correctInputWrap').classList.toggle('hidden', options.score);
  $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').textContent = '下一步：复盘'; $('#finishDialog').showModal();
  (options.score ? $('#finishScore') : (options.editableQuestions ? $('#finishQuestionCount') : $('#finishCorrectCount'))).focus();
}

function saveTimedCorrectSession() {
  let questions = state.pendingTimed.questions;
  let score = null;
  if (state.pendingTimed.score) {
    score = toScore($('#finishScore').value);
    if (score === null) { showToast('分数需在 0 到 100 之间'); $('#finishScore').focus(); return; }
  }
  if (state.pendingTimed.editableQuestions) {
    questions = toPositiveInt($('#finishQuestionCount').value);
    if (!questions) { showToast('请填写完成题数'); $('#finishQuestionCount').focus(); return; }
    $('#finishCorrectCount').max = String(questions);
  }
  const correct = state.pendingTimed.score ? null : toNonNegativeInt($('#finishCorrectCount').value);
  if (!state.pendingTimed.score && (correct === null || correct > questions)) { showToast(`正确数量需在 0 到 ${questions} 之间`); $('#finishCorrectCount').focus(); return; }
  const papers = state.pendingTimed.papers;
  const result = { questions, papers, correct, score, endedAt: state.pendingTimed.endedAt, metaDraft: state.pendingTimed.metaDraft };
  $('#finishDialog').close(); resetFinishDialog();
  if (state.pendingTimed.score && state.mode === 'mock' && state.preset.name === '行测模考') {
    const restored = state.pendingMockModuleDraft;
    if (restored) { restored.result = { ...restored.result, ...result }; openMockModuleReview(restored.result, { pending: restored }); }
    else openMockModuleReview(result);
    return;
  }
  state.pendingTimed = null; beginTimedMeta(result, { kind: 'finish' });
}

export { confirmFinish, getAccuracyTotals, getScoreAverage, hasAccuracy, openCorrectInputDialog, recordLap, renderLapPanel, renderPacingStatus, renderPresets, requestFinish, resetTimer, saveQuantitySession, selectPreset, setMode, startOrPause, tick, undoLap };
