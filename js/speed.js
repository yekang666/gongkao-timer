import { $, $$, SECTION_QUESTION_COUNTS, SPEED_SCORE_TYPES, TRACKING_CATEGORIES, capRecords, clearActiveSession, normalizeLaps, normalizeModuleResults, normalizeTrainingMeta, persistActiveSession, saveRecords, state, toNonNegativeInt, toScore } from './core.js';
import { formatAccuracy, formatClock, formatScore } from './format.js';
import { openTrainingMetaDialog } from './mock.js';
import { syncMobilePipSource, syncNativeVideoTime } from './pip.js';
import { openLapDetail, render } from './render.js';
import { renderStats } from './stats.js';
import { tick } from './timer.js';
import { hideToast, showToast, stopInterval } from './ui.js';

function finishSpeedSession() {
  tick(); if (state.elapsed < .5) return;
  state.pendingSpeed = { duration: Math.round(state.elapsed), startedAt: state.startedAt, endedAt: new Date().toISOString(), laps: normalizeLaps(state.laps) };
  stopInterval(); state.status = 'paused'; persistActiveSession(true); render(); syncNativeVideoTime(true); openSpeedSaveDialog();
}

function openSpeedSaveDialog() {
  state.pendingSpeed.step = 'type';
  $('#speedCountWrap').classList.add('hidden'); $('#speedCorrectWrap').classList.add('hidden'); $('#speedScoreWrap').classList.add('hidden'); $('#nextSpeedStepBtn').classList.add('hidden');
  configureSpeedStepper(false); renderSpeedTypePicker();
  updateSpeedDialogStep('type', { title: '先选择本次刷题类型', message: `本次正计时 ${formatClock(state.pendingSpeed.duration)}，不同题型将使用对应的保存流程。` });
  $('#singleModuleDialog').showModal();
  $('#singleModulePicker .module-choice').focus();
}

function configureSpeedStepper(scoreOnly) {
  const config = scoreOnly ? [['type', '分类'], ['score', '成绩']] : [['type', '分类'], ['questions', '题量'], ['correct', '正确数']];
  const indicators = $$('[data-speed-indicator]');
  indicators.forEach((indicator, index) => {
    const item = config[index]; indicator.classList.toggle('hidden', !item);
    if (!item) return;
    indicator.dataset.runtimeStep = item[0]; indicator.querySelector('b').textContent = String(index + 1); indicator.querySelector('i').textContent = item[1];
  });
  $('#singleModuleDialog .speed-stepper').classList.toggle('two-steps', scoreOnly);
}

function updateSpeedDialogStep(step, { title, message, nextLabel = '' }) {
  const indicators = $$('[data-speed-indicator]').filter(indicator => !indicator.classList.contains('hidden'));
  const currentIndex = indicators.findIndex(indicator => indicator.dataset.runtimeStep === step);
  const labels = { type: '选择分类', questions: '填写题量', correct: '核对正确数', score: '填写成绩' };
  $('#singleModuleDialog').dataset.step = step;
  $('#singleDialogIcon').textContent = String(currentIndex + 1);
  $('#singleDialogKicker').textContent = `第 ${currentIndex + 1} 步 · ${labels[step]}`;
  $('#singleDialogTitle').textContent = title;
  $('#singleLapMessage').textContent = message;
  indicators.forEach((indicator, index) => {
    indicator.classList.toggle('active', index === currentIndex);
    indicator.classList.toggle('completed', index < currentIndex);
    if (index === currentIndex) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
  });
  $('#nextSpeedStepBtn').textContent = nextLabel;
  $('#previousSpeedStepBtn').classList.toggle('hidden', step === 'type');
}

function renderSpeedTypePicker() {
  const picker = $('#singleModulePicker'); picker.innerHTML = '';
  TRACKING_CATEGORIES.forEach(moduleName => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'module-choice';
    button.innerHTML = `<strong>${moduleName}</strong><small>${SPEED_SCORE_TYPES.has(moduleName) ? '只填分数' : '题量 + 正确数'}</small>`;
    button.addEventListener('click', () => selectSpeedType(moduleName)); picker.appendChild(button);
  });
  picker.classList.remove('hidden');
}

function selectSpeedType(moduleName) {
  const session = state.pendingSpeed; if (!session) return;
  const sameModule = session.moduleName === moduleName;
  if (!sameModule) { session.questions = null; session.correct = null; session.score = null; session.papers = null; }
  session.moduleName = moduleName; $('#singleModulePicker').classList.add('hidden');
  if (SPEED_SCORE_TYPES.has(moduleName)) {
    session.step = 'score'; session.questions = session.laps.length || null; session.correct = null; session.papers = 1;
    configureSpeedStepper(true); $('#speedScore').value = sameModule ? (session.score ?? '') : ''; $('#speedScoreWrap').classList.remove('hidden'); $('#nextSpeedStepBtn').classList.remove('hidden');
    const lapText = session.laps.length ? `已自动记录 ${session.laps.length} 次逐题打点；` : '';
    updateSpeedDialogStep('score', { title: `填写${moduleName}成绩`, message: `${lapText}模考类型只需填写本次得分。`, nextLabel: '下一步：复盘' });
    $('#speedScore').focus(); return;
  }
  const lapCount = session.laps.length; session.step = 'questions'; session.papers = null;
  configureSpeedStepper(false); $('#speedQuestionCount').value = lapCount ? String(lapCount) : (sameModule ? (session.questions ?? 1) : 1); $('#speedQuestionCount').readOnly = lapCount > 0; $('#speedCountWrap').classList.remove('hidden'); $('#nextSpeedStepBtn').classList.remove('hidden');
  $('#speedCountLabel').textContent = lapCount ? '逐题打点数量' : '本组题目数量';
  $('#speedCountHint').textContent = lapCount ? `已根据 ${lapCount} 次打点自动填写；如需修改，请取消后撤销打点` : '填写本轮实际完成的题数';
  updateSpeedDialogStep('questions', { title: lapCount ? `已记录 ${lapCount} 题逐题用时` : `${moduleName}做了多少题？`, message: lapCount ? '题量已由逐题打点自动生成。' : '请填写本轮实际完成的题数。', nextLabel: '下一步：填写正确数' });
  $('#speedQuestionCount').focus(); if (!lapCount) $('#speedQuestionCount').select();
}

function showSpeedNextStep() {
  if (!state.pendingSpeed) return;
  if (state.pendingSpeed.step === 'score') { finishSpeedScoreStep(); return; }
  if (state.pendingSpeed.step === 'questions') { showSpeedCorrectStep(); return; }
  if (state.pendingSpeed.step === 'correct') finishSpeedCorrectStep();
}

function showSpeedCorrectStep() {
  const questions = Math.floor(Number($('#speedQuestionCount').value) || 0);
  if (questions < 1) { showToast('请先输入刷题数量'); $('#speedQuestionCount').focus(); return; }
  hideToast();
  state.pendingSpeed.questions = questions; state.pendingSpeed.step = 'correct';
  $('#speedCorrectCount').max = String(questions); $('#speedCorrectCount').value = state.pendingSpeed.correct ?? ''; $('#speedCorrectCount').placeholder = `0 - ${questions}`;
  $('#speedCorrectHint').textContent = `请输入 0 到 ${questions}，此处不会默认按全部正确填写`;
  $('#speedCountWrap').classList.add('hidden'); $('#speedCorrectWrap').classList.remove('hidden');
  updateSpeedDialogStep('correct', {
    title: '这组做对了多少题？',
    message: `上一步记录了 ${questions} 题。请核对后主动填写正确数量。`,
    nextLabel: '下一步：复盘'
  });
  $('#speedCorrectCount').focus();
}

function finishSpeedCorrectStep() {
  const questions = state.pendingSpeed.questions || 1;
  const correct = toNonNegativeInt($('#speedCorrectCount').value);
  if (correct === null || correct > questions) { showToast(`正确数量需在 0 到 ${questions} 之间`); $('#speedCorrectCount').focus(); return; }
  hideToast();
  state.pendingSpeed.correct = correct; beginSpeedMeta();
}

function finishSpeedScoreStep() {
  const score = toScore($('#speedScore').value);
  if (score === null) { showToast('分数需在 0 到 100 之间'); $('#speedScore').focus(); return; }
  hideToast(); state.pendingSpeed.score = score; beginSpeedMeta();
}

function beginSpeedMeta() {
  const session = state.pendingSpeed; if (!session?.moduleName) return;
  state.pendingMeta = { context: 'speed', moduleName: session.moduleName, previous: { kind: 'speed' } };
  $('#singleModuleDialog').close(); openTrainingMetaDialog(`${session.moduleName} · 训练复盘`, session.metaDraft, true);
}

function showSpeedPreviousStep() {
  const session = state.pendingSpeed; if (!session) return;
  if (session.step === 'score') {
    session.score = $('#speedScore').value;
    session.step = 'type'; $('#speedScoreWrap').classList.add('hidden'); $('#nextSpeedStepBtn').classList.add('hidden');
    configureSpeedStepper(false); renderSpeedTypePicker();
    updateSpeedDialogStep('type', { title: '先选择本次刷题类型', message: `本次正计时 ${formatClock(session.duration)}，不同题型将使用对应的保存流程。` });
    $('#singleModulePicker .module-choice').focus();
    return;
  }
  if (session.step === 'questions') {
    session.questions = $('#speedQuestionCount').value;
    session.step = 'type'; $('#speedCountWrap').classList.add('hidden'); $('#nextSpeedStepBtn').classList.add('hidden');
    renderSpeedTypePicker();
    updateSpeedDialogStep('type', { title: '先选择本次刷题类型', message: `本次正计时 ${formatClock(session.duration)}，不同题型将使用对应的保存流程。` });
    $('#singleModulePicker .module-choice').focus();
    return;
  }
  if (session.step === 'correct') {
    session.correct = $('#speedCorrectCount').value;
    session.step = 'questions'; $('#speedCorrectWrap').classList.add('hidden'); $('#speedCountWrap').classList.remove('hidden');
    $('#speedQuestionCount').value = session.questions || 1;
    updateSpeedDialogStep('questions', { title: `${session.moduleName}做了多少题？`, message: '请填写本轮实际完成的题数。', nextLabel: '下一步：填写正确数' });
    $('#speedQuestionCount').focus();
  }
}

function resumeSpeedReviewStep() {
  const session = state.pendingSpeed; if (!session) return;
  const isScore = session.step === 'score';
  $('#singleModulePicker').classList.add('hidden'); $('#speedCountWrap').classList.toggle('hidden', isScore); $('#speedCorrectWrap').classList.toggle('hidden', true); $('#speedScoreWrap').classList.toggle('hidden', !isScore); $('#nextSpeedStepBtn').classList.remove('hidden');
  if (isScore) {
    configureSpeedStepper(true); $('#speedScore').value = session.score ?? '';
    updateSpeedDialogStep('score', { title: `填写${session.moduleName}成绩`, message: '模考类型只需填写本次得分。', nextLabel: '下一步：复盘' });
    $('#speedScore').focus();
  } else {
    configureSpeedStepper(false); session.step = 'correct'; $('#speedCountWrap').classList.add('hidden'); $('#speedCorrectWrap').classList.remove('hidden');
    $('#speedCorrectCount').max = String(session.questions || 1); $('#speedCorrectCount').value = session.correct ?? '';
    updateSpeedDialogStep('correct', { title: '这组做对了多少题？', message: `上一步记录了 ${session.questions || 1} 题。请核对后主动填写正确数量。`, nextLabel: '下一步：复盘' });
    $('#speedCorrectCount').focus();
  }
  $('#singleModuleDialog').showModal();
}

function finalizeSpeedSession(moduleName, meta = {}) {
  const session = state.pendingSpeed; if (!session) return;
  const questions = session.questions || null, correct = session.correct ?? null, score = toScore(session.score), papers = session.papers ?? null;
  const savedRecord = { id: crypto.randomUUID?.() || `${Date.now()}`, mode: 'single', module: moduleName, duration: session.duration, planned: null, startedAt: session.startedAt, endedAt: session.endedAt, questions, papers, correct, score, laps: session.laps, lapReviews: [], ...normalizeTrainingMeta(meta) };
  const previousRecords = [...state.records];
  state.records.unshift(savedRecord);
  state.records = capRecords(state.records);
  if (!saveRecords()) { state.records = previousRecords; return; }
  const resultText = score !== null ? `分数 ${formatScore(score)}` : `${questions} 题，正确率 ${formatAccuracy(correct, questions)}`;
  const paceText = questions ? `，均时 ${formatClock(session.duration / questions).slice(3)}` : '';
  state.pendingSpeed = null; clearActiveSession(); $('#singleModuleDialog').close(); resetSpeedSaveDialog(); state.elapsed = 0; state.startedAt = null; state.status = 'idle'; state.laps = []; state.lastLapElapsed = 0; renderStats(); render(); syncMobilePipSource(true); showToast(`已记录到${moduleName}：${resultText}${paceText}`);
  if (savedRecord.laps.length) openLapDetail(savedRecord.id);
}

function resetSpeedSaveDialog() {
  $('#speedCountWrap').classList.add('hidden'); $('#speedCorrectWrap').classList.add('hidden'); $('#speedScoreWrap').classList.add('hidden'); $('#singleModulePicker').classList.add('hidden'); $('#nextSpeedStepBtn').classList.add('hidden');
  $('#speedQuestionCount').readOnly = false; $('#speedCountLabel').textContent = '本组题目数量'; $('#speedCountHint').textContent = '填写本轮实际完成的题数';
  configureSpeedStepper(false); updateSpeedDialogStep('type', { title: '先选择本次刷题类型', message: '', nextLabel: '' });
}

function cancelSpeedSession() {
  state.pendingSpeed = null; state.status = 'paused'; $('#singleModuleDialog').close(); resetSpeedSaveDialog(); render(); syncMobilePipSource(true); showToast('已返回计时，可撤销打点或继续训练');
}

function getDefaultQuestionCount() {
  return state.mode === 'section' ? (SECTION_QUESTION_COUNTS[state.preset.name] || null) : null;
}

function saveSession(questions, papers = null, correct = null, score = null, laps = [], meta = {}, moduleResults = [], endedAt = new Date().toISOString()) {
  if (state.elapsed < 1) return null;
  const savedRecord = { id: crypto.randomUUID?.() || `${Date.now()}`, mode: state.mode, module: state.preset.name, duration: Math.round(state.elapsed), planned: state.duration, startedAt: state.startedAt, endedAt, questions, papers, correct, score, laps: normalizeLaps(laps), lapReviews: [], moduleResults: normalizeModuleResults(moduleResults), ...normalizeTrainingMeta(meta) };
  const previousRecords = [...state.records];
  state.records.unshift(savedRecord);
  state.records = capRecords(state.records);
  if (!saveRecords()) { state.records = previousRecords; return null; }
  renderStats(); return savedRecord;
}

export { cancelSpeedSession, finalizeSpeedSession, finishSpeedSession, resumeSpeedReviewStep, saveSession, showSpeedNextStep, showSpeedPreviousStep };
