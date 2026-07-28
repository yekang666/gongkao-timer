import { playBeep, showTimeUpNotice, stopAlertKeepAlive } from './audio.js';
import { APP_EVENTS, emitAppEvent } from './app-events.js';
import { $, $$, PRESETS, SECTION_QUESTION_COUNTS, clearActiveSession, persistActiveSession, state, toNonNegativeInt, toPositiveInt, toScore } from './core.js';
import { formatClock, formatDuration } from './format.js';
import { getMockPacingPlan, isMockPacingActive } from './pacing.js';
import { syncMobilePipSource, syncNativeVideoTime, updatePip } from './pip.js';
import { render } from './render.js';
import { appConfirm, resetFinishDialog, showToast, stopInterval } from './ui.js';

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
  if (!questions && !options.editableQuestions && !options.score) { emitAppEvent(APP_EVENTS.OPEN_TIMED_META, { result: { questions: null, papers: null, correct: null, score: null, endedAt: options.endedAt || new Date().toISOString() } }); return; }
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
    if (restored) { restored.result = { ...restored.result, ...result }; emitAppEvent(APP_EVENTS.OPEN_MOCK_REVIEW, { result: restored.result, options: { pending: restored } }); }
    else emitAppEvent(APP_EVENTS.OPEN_MOCK_REVIEW, { result });
    return;
  }
  state.pendingTimed = null; emitAppEvent(APP_EVENTS.OPEN_TIMED_META, { result, previous: { kind: 'finish' } });
}

export { confirmFinish, openCorrectInputDialog, recordLap, renderPresets, requestFinish, resetTimer, saveQuantitySession, selectPreset, setMode, startOrPause, tick, undoLap };
