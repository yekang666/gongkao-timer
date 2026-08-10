import { playBeep, showTimeUpNotice, stopAlertKeepAlive } from './audio.js';
import { APP_EVENTS, emitAppEvent } from './app-events.js';
import { $, $$, ESSAY_MODULE_NAMES, PRESETS, SECTION_QUESTION_COUNTS, XINGCE_MODULE_NAMES, clearActiveSession, persistActiveSession, state, toNonNegativeInt, toPositiveInt, toScore } from './core.js';
import { formatClock, formatDuration } from './format.js';
import { getMockPacingPlan, isMockPacingActive } from './pacing.js';
import { syncMobilePipSource, syncNativeVideoTime, updatePip } from './pip.js';
import { render } from './render.js';
import { appConfirm, resetFinishDialog, showToast, stopInterval } from './ui.js';

function renderPresets() {
  const list = $('#presetList'), groupSwitch = $('#sectionGroupSwitch'); list.innerHTML = '';
  if (state.mode === 'single') { $('#presetArea').classList.add('hidden'); return; }
  $('#presetArea').classList.remove('hidden');
  groupSwitch.classList.toggle('hidden', state.mode !== 'section');
  let presets = PRESETS[state.mode];
  if (state.mode === 'section') {
    state.sectionGroup = ESSAY_MODULE_NAMES.includes(state.preset.name) ? 'essay' : (state.sectionGroup === 'essay' ? 'essay' : 'xingce');
    const visibleNames = state.sectionGroup === 'essay' ? ESSAY_MODULE_NAMES : XINGCE_MODULE_NAMES;
    presets = PRESETS.section.filter(preset => visibleNames.includes(preset.name));
    $$('[data-section-group]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sectionGroup === state.sectionGroup)));
  }
  presets.forEach(preset => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'preset-button';
    if (state.preset.name === preset.name) button.classList.add('active');
    button.innerHTML = `<strong>${preset.name}</strong><span>${preset.seconds / 60} 分钟</span>`;
    button.addEventListener('click', () => selectPreset(preset)); list.appendChild(button);
  });
}

function selectPreset(preset) {
  if (state.status === 'running') return false;
  if (state.preset === preset) return true;
  if (state.elapsed >= 1 && !appConfirm('切换题型会清空当前未保存的计时和打点，确定继续吗？')) return false;
  if (state.mode === 'section') state.sectionGroup = ESSAY_MODULE_NAMES.includes(preset.name) ? 'essay' : 'xingce';
  state.preset = preset; state.duration = preset.seconds; resetTimer(false); renderPresets();
  return true;
}

function setSectionGroup(group) {
  if (state.mode !== 'section' || !['xingce', 'essay'].includes(group) || state.status === 'running' || state.sectionGroup === group) return;
  const names = group === 'essay' ? ESSAY_MODULE_NAMES : XINGCE_MODULE_NAMES;
  const nextPreset = PRESETS.section.find(preset => names.includes(preset.name));
  if (!nextPreset) return;
  if (state.elapsed >= 1 && !appConfirm('切换专项类别会清空当前未保存的计时和打点，确定继续吗？')) return;
  state.sectionGroup = group; state.preset = nextPreset; state.duration = nextPreset.seconds;
  resetTimer(false); renderPresets();
}

function setMode(mode) {
  if (mode === state.mode) return;
  if (state.elapsed >= 1 && !appConfirm('切换模式会清空当前未保存的训练，确定继续吗？')) return;
  stopInterval(); state.mode = mode; state.preset = PRESETS[mode][0]; state.sectionGroup = mode === 'section' ? 'xingce' : state.sectionGroup; state.duration = state.preset.seconds;
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

function requestFinish() {
  if (state.elapsed < 1) return;
  if (state.mode === 'single') { emitAppEvent(APP_EVENTS.FINISH_SPEED); return; }
  const endedAt = new Date().toISOString();
  pauseTimer();
  const lapQuestions = state.laps.length || null;
  if (state.mode === 'mock') { openCorrectInputDialog(lapQuestions, { score: true, endedAt }); return; }
  if (state.preset.name === '数量关系' && !lapQuestions) { openQuantityChoiceDialog(endedAt); return; }
  const isEssaySection = ESSAY_MODULE_NAMES.includes(state.preset.name);
  openCorrectInputDialog(isEssaySection ? null : (lapQuestions || SECTION_QUESTION_COUNTS[state.preset.name] || null), { endedAt, score: isEssaySection, totalScore: isEssaySection });
}

function confirmFinish() {
  if (state.status === 'finished' && state.autoFinished) { $('#finishDialog').close(); resetFinishDialog(); return; }
  if (state.pendingTimed?.step === 'correct') saveTimedCorrectSession();
}

function openQuantityChoiceDialog(endedAt = new Date().toISOString()) {
  state.pendingTimed = { step: 'quantity', endedAt };
  $('#dialogTitle').textContent = '选择数量关系题量';
  $('#dialogMessage').textContent = `本次训练 ${formatDuration(state.elapsed)}，请选择本组数量关系题量。`;
  $('#totalScoreInputWrap').classList.add('hidden'); $('#scoreInputWrap').classList.add('hidden'); $('#questionInputWrap').classList.add('hidden'); $('#correctInputWrap').classList.add('hidden'); $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').classList.add('hidden');
  $('#quantityChoiceWrap').classList.remove('hidden'); $('#finishDialog').showModal();
}

function saveQuantitySession(questions) {
  const endedAt = state.pendingTimed?.endedAt;
  $('#finishDialog').close(); resetFinishDialog(); openCorrectInputDialog(questions, { endedAt });
}

function openCorrectInputDialog(questions, options = {}) {
  if (!questions && !options.editableQuestions && !options.score) { emitAppEvent(APP_EVENTS.OPEN_TIMED_META, { result: { questions: null, correct: null, score: null, endedAt: options.endedAt || new Date().toISOString() } }); return; }
  state.pendingTimed = { step: 'correct', questions, editableQuestions: Boolean(options.editableQuestions), score: Boolean(options.score), totalScore: Boolean(options.totalScore), endedAt: options.endedAt || options.initial?.endedAt || new Date().toISOString(), metaDraft: options.initial?.metaDraft || null };
  const hasTotalScore = Boolean(options.totalScore);
  $('#dialogTitle').textContent = hasTotalScore ? '填写总分与得分' : (options.score ? '填写本次分数' : (options.editableQuestions ? '填写本次正确率' : '填写正确数量'));
  if (hasTotalScore) $('#dialogMessage').textContent = `本次${state.preset.name} ${formatDuration(state.elapsed)}，请输入本题总分和实际得分。`;
  else if (options.score) $('#dialogMessage').textContent = `本次${state.preset.name} ${formatDuration(state.elapsed)}，请输入本次得分。`;
  else if (options.editableQuestions) $('#dialogMessage').textContent = `本次${state.preset.name} ${formatDuration(state.elapsed)}，请输入完成题数和正确数量。`;
  else $('#dialogMessage').textContent = `本次共 ${questions} 题，请输入做对的题数。`;
  const initial = options.initial || {};
  $('#finishTotalScore').value = initial.totalScore ?? '';
  $('#finishScore').value = initial.score ?? '';
  $('#finishQuestionCount').value = initial.questions ?? (questions ? String(questions) : '');
  $('#finishCorrectCount').max = questions ? String(questions) : '';
  $('#finishCorrectCount').value = initial.correct ?? (questions ? String(questions) : '');
  $('#totalScoreInputWrap').classList.toggle('hidden', !hasTotalScore);
  $('#scoreInputWrap').classList.toggle('hidden', !options.score);
  $('#scoreInputLabel').textContent = hasTotalScore ? '得分' : '本次分数';
  $('#questionInputWrap').classList.toggle('hidden', !options.editableQuestions);
  $('#quantityChoiceWrap').classList.add('hidden'); $('#correctInputWrap').classList.toggle('hidden', options.score);
  $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').textContent = '下一步：复盘'; $('#finishDialog').showModal();
  (hasTotalScore ? $('#finishTotalScore') : (options.score ? $('#finishScore') : (options.editableQuestions ? $('#finishQuestionCount') : $('#finishCorrectCount')))).focus();
}

function saveTimedCorrectSession() {
  let questions = state.pendingTimed.questions;
  let score = null;
  let totalScore = null;
  if (state.pendingTimed.totalScore) {
    totalScore = toScore($('#finishTotalScore').value);
    if (totalScore === null || totalScore <= 0) { showToast('总分需在 0 到 100 之间'); $('#finishTotalScore').focus(); return; }
  }
  if (state.pendingTimed.score) {
    score = toScore($('#finishScore').value);
    if (score === null) { showToast('分数需在 0 到 100 之间'); $('#finishScore').focus(); return; }
    if (totalScore !== null && score > totalScore) { showToast('得分不能高于总分'); $('#finishScore').focus(); return; }
  }
  if (state.pendingTimed.editableQuestions) {
    questions = toPositiveInt($('#finishQuestionCount').value);
    if (!questions) { showToast('请填写完成题数'); $('#finishQuestionCount').focus(); return; }
    $('#finishCorrectCount').max = String(questions);
  }
  const correct = state.pendingTimed.score ? null : toNonNegativeInt($('#finishCorrectCount').value);
  if (!state.pendingTimed.score && (correct === null || correct > questions)) { showToast(`正确数量需在 0 到 ${questions} 之间`); $('#finishCorrectCount').focus(); return; }
  const result = { questions, correct, score, totalScore, endedAt: state.pendingTimed.endedAt, metaDraft: state.pendingTimed.metaDraft };
  $('#finishDialog').close(); resetFinishDialog();
  if (state.pendingTimed.score && state.mode === 'mock' && state.preset.name === '行测模考') {
    const restored = state.pendingMockModuleDraft;
    if (restored) { restored.result = { ...restored.result, ...result }; emitAppEvent(APP_EVENTS.OPEN_MOCK_REVIEW, { result: restored.result, options: { pending: restored } }); }
    else emitAppEvent(APP_EVENTS.OPEN_MOCK_REVIEW, { result });
    return;
  }
  state.pendingTimed = null; emitAppEvent(APP_EVENTS.OPEN_TIMED_META, { result, previous: { kind: 'finish' } });
}

export { confirmFinish, openCorrectInputDialog, recordLap, renderPresets, requestFinish, resetTimer, saveQuantitySession, selectPreset, setMode, setSectionGroup, startOrPause, tick, undoLap };
