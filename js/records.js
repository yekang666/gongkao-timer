import { $, $$, normalizeLaps, normalizeModuleResults, normalizeRecords, normalizeText, saveRecords, state, toNonNegativeInt, toPositiveInt, toScore } from './core.js';
import { renderDataManagementSummary, renderStats } from './stats.js';
import { showToast } from './ui.js';

function toDateTimeLocalValue(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function fromDateTimeLocalValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function openRecordCreator() {
  const form = $('#recordCreateForm');
  form.reset();
  $('#createRecordMode').value = state.mode;
  $('#createRecordEndedAt').value = toDateTimeLocalValue(new Date().toISOString());
  $('#createRecordSeconds').value = '0';
  setDifficultyChoice('createRecordDifficultyChoices', null);
  $('#recordCreateDialog').showModal();
  $('#createRecordModule').focus();
}

function closeRecordCreator() {
  const dialog = $('#recordCreateDialog');
  if (dialog.open) dialog.close();
}

function saveRecordCreator() {
  const moduleName = normalizeText($('#createRecordModule').value, 80);
  if (!moduleName) { showToast('请填写题型或模块'); $('#createRecordModule').focus(); return; }
  const mode = $('#createRecordMode').value;
  if (!['mock', 'section', 'single'].includes(mode)) { showToast('请选择训练模式'); $('#createRecordMode').focus(); return; }
  const minutes = Math.floor(Number($('#createRecordMinutes').value || 0));
  const seconds = Math.floor(Number($('#createRecordSeconds').value || 0));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0 || seconds > 59) {
    showToast('用时格式不正确'); $('#createRecordMinutes').focus(); return;
  }
  const duration = minutes * 60 + seconds;
  if (duration <= 0 || duration > 6 * 60 * 60) { showToast('用时需要在 1 秒到 6 小时之间'); $('#createRecordMinutes').focus(); return; }
  const endedAt = fromDateTimeLocalValue($('#createRecordEndedAt').value);
  if (!endedAt) { showToast('请选择有效的结束时间'); $('#createRecordEndedAt').focus(); return; }
  const scoreRaw = $('#createRecordScore').value.trim(), score = toScore(scoreRaw);
  if (scoreRaw && score === null) { showToast('分数需要在 0 到 100 之间'); $('#createRecordScore').focus(); return; }
  const questionsRaw = $('#createRecordQuestions').value.trim(), questions = questionsRaw ? toPositiveInt(questionsRaw) : null;
  if (questionsRaw && questions === null) { showToast('题量需要大于 0'); $('#createRecordQuestions').focus(); return; }
  const correctRaw = $('#createRecordCorrect').value.trim(), correct = correctRaw ? toNonNegativeInt(correctRaw) : null;
  if (correctRaw && correct === null) { showToast('正确数不能小于 0'); $('#createRecordCorrect').focus(); return; }
  if (correct !== null && questions === null) { showToast('填写正确数前，先补上题量'); $('#createRecordQuestions').focus(); return; }
  if (questions !== null && correct !== null && correct > questions) { showToast('正确数不能大于题量'); $('#createRecordCorrect').focus(); return; }
  const papersRaw = $('#createRecordPapers').value.trim(), papers = papersRaw ? toPositiveInt(papersRaw) : null;
  if (papersRaw && papers === null) { showToast('套数需要大于 0'); $('#createRecordPapers').focus(); return; }

  const record = normalizeRecords([{
    id: crypto.randomUUID?.() || `${Date.now()}`,
    mode,
    module: moduleName,
    duration,
    startedAt: new Date(new Date(endedAt).getTime() - duration * 1000).toISOString(),
    endedAt,
    questions,
    correct,
    score,
    papers,
    laps: [],
    lapReviews: [],
    moduleResults: [],
    source: $('#createRecordSource').value,
    difficulty: $('#createRecordDifficultyChoices [aria-pressed="true"]')?.dataset.difficulty || null,
    note: $('#createRecordNote').value
  }])[0];
  if (!record) { showToast('这条训练记录无法保存，请检查填写内容'); return; }
  const previousRecords = state.records;
  const reachedLimit = previousRecords.length >= 500;
  state.records = [record, ...previousRecords].sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt)).slice(0, 500);
  if (!saveRecords()) { state.records = previousRecords; return; }
  renderStats(); renderDataManagementSummary(); closeRecordCreator();
  showToast(reachedLimit ? `已新增${moduleName}记录，已保留最近 500 条` : `已新增${moduleName}训练记录`);
}

function setDifficultyChoice(containerId, difficulty) {
  $$(`#${containerId} [data-difficulty]`).forEach(button => {
    const selected = button.dataset.difficulty === difficulty;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function openRecordEditor(recordId) {
  const record = state.records.find(item => item.id === recordId);
  if (!record) return;
  const duration = Math.max(1, Math.round(Number(record.duration) || 0));
  state.editingRecordId = record.id;
  $('#recordEditTitle').textContent = `${record.module} · 修改记录`;
  $('#recordEditMessage').textContent = `这条记录保存于 ${new Date(record.endedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  $('#editRecordModule').value = record.module || '';
  $('#editRecordEndedAt').value = toDateTimeLocalValue(record.endedAt);
  $('#editRecordMinutes').value = String(Math.floor(duration / 60));
  $('#editRecordSeconds').value = String(duration % 60);
  $('#editRecordScore').value = toScore(record.score) === null ? '' : String(toScore(record.score));
  $('#editRecordQuestions').value = toPositiveInt(record.questions) === null ? '' : String(toPositiveInt(record.questions));
  $('#editRecordCorrect').value = toNonNegativeInt(record.correct) === null ? '' : String(toNonNegativeInt(record.correct));
  $('#editRecordPapers').value = toPositiveInt(record.papers) === null ? '' : String(toPositiveInt(record.papers));
  $('#editRecordSource').value = record.source || '';
  $('#editRecordNote').value = record.note || '';
  setDifficultyChoice('editRecordDifficultyChoices', record.difficulty);
  $('#recordEditDialog').showModal();
  $('#editRecordEndedAt').focus();
}

function closeRecordEditor() {
  state.editingRecordId = null;
  const dialog = $('#recordEditDialog');
  if (dialog.open) dialog.close();
}

function saveRecordEditor() {
  const index = state.records.findIndex(item => item.id === state.editingRecordId);
  if (index < 0) return closeRecordEditor();
  const record = state.records[index];
  const moduleName = record.module;
  const minutes = Math.floor(Number($('#editRecordMinutes').value || 0));
  const seconds = Math.floor(Number($('#editRecordSeconds').value || 0));
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0 || seconds > 59) {
    showToast('用时格式不正确');
    $('#editRecordMinutes').focus();
    return;
  }
  const duration = minutes * 60 + seconds;
  if (duration <= 0 || duration > 6 * 60 * 60) {
    showToast('用时需要在 1 秒到 6 小时之间');
    $('#editRecordMinutes').focus();
    return;
  }
  const endedAt = fromDateTimeLocalValue($('#editRecordEndedAt').value);
  if (!endedAt) { showToast('请选择有效的结束时间'); $('#editRecordEndedAt').focus(); return; }
  const scoreRaw = $('#editRecordScore').value.trim();
  const score = toScore(scoreRaw);
  if (scoreRaw && score === null) { showToast('分数需要在 0 到 100 之间'); $('#editRecordScore').focus(); return; }
  const questionsRaw = $('#editRecordQuestions').value.trim();
  const questions = questionsRaw ? toPositiveInt(questionsRaw) : null;
  if (questionsRaw && questions === null) { showToast('题量需要大于 0'); $('#editRecordQuestions').focus(); return; }
  const correctRaw = $('#editRecordCorrect').value.trim();
  const correct = correctRaw ? toNonNegativeInt(correctRaw) : null;
  if (correctRaw && correct === null) { showToast('正确数不能小于 0'); $('#editRecordCorrect').focus(); return; }
  if (correct !== null && questions === null) { showToast('填写正确数前，先补上题量'); $('#editRecordQuestions').focus(); return; }
  if (questions !== null && correct !== null && correct > questions) { showToast('正确数不能大于题量'); $('#editRecordCorrect').focus(); return; }
  const papersRaw = $('#editRecordPapers').value.trim();
  const papers = papersRaw ? toPositiveInt(papersRaw) : null;
  if (papersRaw && papers === null) { showToast('套数需要大于 0'); $('#editRecordPapers').focus(); return; }
  const laps = normalizeLaps(record.laps), lapTotal = laps.reduce((sum, value) => sum + value, 0);
  if (laps.length && questions !== null && questions !== laps.length) { showToast(`题量需与 ${laps.length} 次逐题打点一致`); $('#editRecordQuestions').focus(); return; }
  if (lapTotal > duration) { showToast('总用时不能短于逐题打点用时之和'); $('#editRecordMinutes').focus(); return; }
  const moduleDuration = normalizeModuleResults(record.moduleResults).reduce((sum, item) => sum + (item.duration || 0), 0);
  if (moduleDuration > duration) { showToast('总用时不能短于各模块用时之和'); $('#editRecordMinutes').focus(); return; }
  const endedDate = new Date(endedAt);
  const nextRecord = normalizeRecords([{
    ...record,
    module: moduleName,
    duration,
    startedAt: new Date(endedDate.getTime() - duration * 1000).toISOString(),
    endedAt,
    questions,
    correct,
    score,
    papers,
    source: $('#editRecordSource').value,
    difficulty: $('#editRecordDifficultyChoices [aria-pressed="true"]')?.dataset.difficulty || null,
    note: $('#editRecordNote').value,
    moduleResults: moduleName === '行测模考' ? record.moduleResults : [],
    updatedAt: new Date().toISOString()
  }])[0];
  const previousRecords = [...state.records];
  state.records[index] = nextRecord;
  state.records.sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
  if (!saveRecords()) { state.records = previousRecords; return; }
  renderStats();
  closeRecordEditor();
  showToast('训练记录已更新');
}

function shouldIgnoreRecordOpen(event) {
  return Boolean(event.target.closest('button,a,input,select,textarea,label,[contenteditable="true"]'));
}

function openRecordFromHistoryEvent(event) {
  const editButton = event.target.closest('[data-edit-record-id]');
  if (editButton) { openRecordEditor(editButton.dataset.editRecordId); return; }
  if (shouldIgnoreRecordOpen(event)) return;
  const row = event.target.closest('[data-record-id]');
  if (row) openRecordEditor(row.dataset.recordId);
}

function openRecordFromHistoryKey(event) {
  if (!['Enter', ' '].includes(event.key) || shouldIgnoreRecordOpen(event)) return;
  const row = event.target.closest('[data-record-id]');
  if (!row) return;
  event.preventDefault();
  openRecordEditor(row.dataset.recordId);
}

export { closeRecordCreator, closeRecordEditor, openRecordCreator, openRecordFromHistoryEvent, openRecordFromHistoryKey, saveRecordCreator, saveRecordEditor, setDifficultyChoice };
