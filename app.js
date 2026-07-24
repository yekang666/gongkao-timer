const PRESETS = {
  mock: [
    { name: '行测模考', seconds: 120 * 60 },
    { name: '申论省考', seconds: 150 * 60 },
    { name: '申论国考', seconds: 180 * 60 }
  ],
  section: [
    { name: '资料分析', seconds: 25 * 60 }, { name: '言语理解', seconds: 30 * 60 },
    { name: '判断推理', seconds: 35 * 60 }, { name: '数量关系', seconds: 20 * 60 },
    { name: '政治理论', seconds: 10 * 60 }, { name: '常识判断', seconds: 5 * 60 }
  ],
  single: [{ name: '自由测速', seconds: 0 }]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const STORAGE_RECORDS = 'examTimer.records.v1';
const STORAGE_SETTINGS = 'examTimer.settings.v1';
const APP_VERSION = 'v2.12.0';
const TRACKING_CATEGORIES = [...PRESETS.mock, ...PRESETS.section].map(({ name }) => name);
const SECTION_QUESTION_COUNTS = { '资料分析': 20, '言语理解': 30, '判断推理': 35, '政治理论': 20, '常识判断': 15 };
const MOCK_PACING_QUESTION_COUNTS = { ...SECTION_QUESTION_COUNTS, '数量关系': 15 };
const MOCK_MODULE_NAMES = PRESETS.section.map(preset => preset.name);
const TRAINING_DIFFICULTIES = ['简单', '正常', '较难'];
const SPEED_SCORE_TYPES = new Set(PRESETS.mock.map(preset => preset.name));
const LAP_REVIEW_STATUSES = ['correct', 'wrong', 'skipped'];
const LAP_ERROR_REASONS = ['知识盲区', '理解偏差', '计算失误', '方法不优', '时间不足'];
const DEFAULT_SECTION_ORDER = PRESETS.section.map(preset => preset.name);
const ANALYTICS_COLORS = ['#2e6754', '#c46a20', '#54799a', '#8a6c9b', '#b83b35', '#638467', '#a46d4c', '#467b86', '#7b7791'];
const FOCUS_SOUND_TYPES = {
  white: { label: '白噪音', hint: '均匀沙沙声，适合屏蔽细碎干扰' },
  pink: { label: '粉噪音', hint: '更柔和，适合长时间阅读和刷题' },
  brown: { label: '棕噪音', hint: '低频更厚，适合深度专注' },
  rain: { label: '雨声', hint: '细密雨点感，节奏稳定' },
  waves: { label: '海浪', hint: '缓慢起伏，适合放松进入状态' },
  cafe: { label: '咖啡馆', hint: '轻微人声氛围，适合不想太安静时' }
};

const state = {
  mode: 'mock', preset: PRESETS.mock[0], duration: PRESETS.mock[0].seconds,
  remaining: PRESETS.mock[0].seconds, elapsed: 0, status: 'idle',
  startedAt: null, tickBase: null, interval: null, autoFinished: false,
  laps: [], lastLapElapsed: 0, pacingNotified: [], pendingImport: null,
  pendingSpeed: null, pendingTimed: null, pendingMeta: null, reviewingRecordId: null, editingRecordId: null, lapReviewDraft: [], analyticsDays: 7, trendMetric: 'duration', trendVisual: 'bar', statsView: 'overview', settingsView: 'general', records: normalizeRecords(loadJSON(STORAGE_RECORDS, [])),
  settings: { sound: true, pacing: true, shortcuts: true, focusSound: {}, dark: false, fontSize: 1, warning: 60, examCountdown: {}, ...loadJSON(STORAGE_SETTINGS, {}) }
};

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function toPositiveInt(value) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toNonNegativeInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function toScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? Math.round(number * 10) / 10 : null;
}

function normalizeLaps(laps) {
  if (!Array.isArray(laps)) return [];
  return laps.map(Number).filter(value => Number.isFinite(value) && value > 0 && value <= 6 * 60 * 60).slice(0, 500).map(value => Math.round(value * 1000) / 1000);
}

function normalizeText(value, maxLength) { return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''; }
function normalizeTrainingMeta(meta = {}) {
  const difficulty = TRAINING_DIFFICULTIES.includes(meta.difficulty) ? meta.difficulty : null;
  return { source: normalizeText(meta.source, 80), difficulty, note: normalizeText(meta.note, 500) };
}
function normalizeLapReviews(reviews, lapCount = 500) {
  if (!Array.isArray(reviews)) return [];
  const normalized = reviews.slice(0, Math.max(0, lapCount)).map(review => {
    if (!review || typeof review !== 'object') return null;
    const status = LAP_REVIEW_STATUSES.includes(review.status) ? review.status : null;
    const reason = status === 'wrong' && LAP_ERROR_REASONS.includes(review.reason) ? review.reason : null;
    const note = normalizeText(review.note, 120);
    return status || reason || note ? { status, reason, note } : null;
  });
  while (normalized.length && !normalized[normalized.length - 1]) normalized.pop();
  return normalized;
}
function normalizeModuleResults(results) {
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  return results.reduce((normalized, result) => {
    if (!result || typeof result !== 'object' || !MOCK_MODULE_NAMES.includes(result.module) || seen.has(result.module)) return normalized;
    const questions = MOCK_PACING_QUESTION_COUNTS[result.module];
    const correct = toNonNegativeInt(result.correct);
    const duration = Number(result.duration);
    const planned = Number(result.planned);
    seen.add(result.module);
    normalized.push({
      module: result.module,
      questions,
      correct: correct === null ? null : Math.min(correct, questions),
      duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
      planned: Number.isFinite(planned) && planned > 0 ? Math.round(planned) : null
    });
    return normalized;
  }, []);
}
function escapeHTML(value) { const element = document.createElement('span'); element.textContent = String(value ?? ''); return element.innerHTML; }
function escapeAttribute(value) { return escapeHTML(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

function normalizeRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.filter(record => record && typeof record === 'object').map(record => {
    const questions = toPositiveInt(record.questions);
    const correct = toNonNegativeInt(record.correct);
    const score = toScore(record.score);
    const laps = normalizeLaps(record.laps);
    const lapReviews = normalizeLapReviews(record.lapReviews, laps.length);
    const moduleResults = normalizeModuleResults(record.moduleResults);
    const meta = normalizeTrainingMeta(record);
    const normalizedRecord = { ...record };
    delete normalizedRecord.overtime;
    delete normalizedRecord.reasons;
    return {
      ...normalizedRecord,
      questions,
      correct: questions && correct !== null ? Math.min(correct, questions) : null,
      score,
      laps,
      lapReviews,
      moduleResults,
      ...meta
    };
  });
}

function saveSettings() { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings)); }
function saveRecords() { localStorage.setItem(STORAGE_RECORDS, JSON.stringify(state.records)); }
function normalizeSectionOrder(order) {
  const requested = Array.isArray(order) ? order.filter((name, index) => DEFAULT_SECTION_ORDER.includes(name) && order.indexOf(name) === index) : [];
  return [...requested, ...DEFAULT_SECTION_ORDER.filter(name => !requested.includes(name))];
}
function applySectionOrder(order = state.settings.sectionOrder) {
  state.settings.sectionOrder = normalizeSectionOrder(order);
}
function getOrderedSectionPresets() {
  const presetsByName = new Map(PRESETS.section.map(preset => [preset.name, preset]));
  return normalizeSectionOrder(state.settings.sectionOrder).map(name => presetsByName.get(name)).filter(Boolean);
}
function getSectionDurations() {
  const section = state.settings.customDurations?.section || {};
  return Object.fromEntries(PRESETS.section.map(preset => [preset.name, Number.isFinite(section[preset.name]) && section[preset.name] > 0 ? Math.round(section[preset.name]) : preset.seconds]));
}
function getSectionOrderSnapshot() {
  const visibleOrder = typeof getSectionCardOrder === 'function' ? getSectionCardOrder() : [];
  return normalizeSectionOrder(visibleOrder.length ? visibleOrder : state.settings.sectionOrder);
}
function getSectionDurationSnapshot() {
  const visibleDurations = {};
  $$('[data-section-time]').forEach(input => {
    const minutes = Math.max(1, Math.floor(Number(input.value) || 0));
    if (input.dataset.sectionTime) visibleDurations[input.dataset.sectionTime] = minutes * 60;
  });
  const source = Object.keys(visibleDurations).length ? visibleDurations : Object.fromEntries(PRESETS.section.map(preset => [preset.name, preset.seconds]));
  return Object.fromEntries(PRESETS.section.map(preset => {
    const seconds = Number(source[preset.name]);
    return [preset.name, Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : preset.seconds];
  }));
}
function applyCustomDurations() {
  applySectionOrder();
  const sectionDurations = getSectionDurations();
  state.settings.customDurations = { ...(state.settings.customDurations || {}), section: sectionDurations };
  PRESETS.section.forEach(preset => { preset.seconds = sectionDurations[preset.name]; });
}
function renderSectionTimeSettings() {
  const grid = $('#sectionTimeGrid'); if (!grid) return;
  grid.innerHTML = getOrderedSectionPresets().map(preset => `<div class="section-time-row" data-section-card data-section-name="${preset.name}" title="长按后拖动可调整模考顺序"><span class="section-drag-handle" aria-hidden="true">⠿</span><label><span>${preset.name}</span><input data-section-time="${preset.name}" type="number" min="1" max="300" step="1" value="${Math.round(preset.seconds / 60)}"><em>分钟</em></label></div>`).join('');
  renderPacingOrderNote();
}
function renderPacingOrderNote(message = '') {
  const note = $('#pacingOrderNote'); if (!note) return;
  note.textContent = message || `模考顺序：${getOrderedSectionPresets().map(preset => preset.name).join(' → ')}`;
}
function saveSectionTimes() {
  const section = {};
  $$('[data-section-time]').forEach(input => { const minutes = Math.max(1, Math.floor(Number(input.value) || 0)); section[input.dataset.sectionTime] = minutes * 60; input.value = minutes; });
  state.settings.customDurations = { ...(state.settings.customDurations || {}), section };
  applyCustomDurations(); state.pacingNotified = []; saveSettings();
  if (state.mode === 'section') { const current = PRESETS.section.find(p => p.name === state.preset.name) || PRESETS.section[0]; state.preset = current; state.duration = current.seconds; resetTimer(false); }
  renderSectionTimeSettings(); renderPresets(); render(); showToast('专项时间已保存');
}

const sectionSort = { card: null, placeholder: null, timer: null, frame: null, active: false, inputType: null, pointerId: null, touchId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, offsetX: 0, offsetY: 0, originalOrder: [] };

function getSectionCardOrder() { return $$('#sectionTimeGrid [data-section-name]').map(card => card.dataset.sectionName); }
function reorderSectionCards(order) {
  const grid = $('#sectionTimeGrid'), cards = new Map($$('#sectionTimeGrid [data-section-card]').map(card => [card.dataset.sectionName, card]));
  order.forEach(name => { if (cards.has(name)) grid.appendChild(cards.get(name)); });
}
function clearSectionFloatingStyles(card) {
  if (!card) return;
  ['position', 'left', 'top', 'width', 'height', 'margin', 'transform'].forEach(property => card.style.removeProperty(property));
}
function resetSectionSortState() {
  clearTimeout(sectionSort.timer); if (sectionSort.frame) cancelAnimationFrame(sectionSort.frame);
  if (sectionSort.placeholder?.isConnected && sectionSort.card) { sectionSort.placeholder.parentNode.insertBefore(sectionSort.card, sectionSort.placeholder); sectionSort.placeholder.remove(); }
  sectionSort.card?.classList.remove('holding', 'dragging'); clearSectionFloatingStyles(sectionSort.card); $('#sectionTimeGrid').classList.remove('sorting');
  document.body.classList.remove('section-reordering');
  Object.assign(sectionSort, { card: null, placeholder: null, timer: null, frame: null, active: false, inputType: null, pointerId: null, touchId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, offsetX: 0, offsetY: 0, originalOrder: [] });
}
function positionFloatingSectionCard(x, y) {
  sectionSort.lastX = x; sectionSort.lastY = y;
  if (sectionSort.frame) return;
  sectionSort.frame = requestAnimationFrame(() => {
    sectionSort.frame = null; if (!sectionSort.active || !sectionSort.card) return;
    const left = sectionSort.lastX - sectionSort.offsetX, top = sectionSort.lastY - sectionSort.offsetY;
    sectionSort.card.style.transform = `translate3d(${left}px,${top}px,0) scale(1.025)`;
  });
}
function animateSectionGridReflow(change) {
  const cards = $$('#sectionTimeGrid [data-section-card]'), before = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
  change();
  cards.forEach(card => {
    const previous = before.get(card), current = card.getBoundingClientRect(), x = previous.left - current.left, y = previous.top - current.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
    card.animate([{ transform: `translate3d(${x}px,${y}px,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}
function activateSectionSort() {
  if (!sectionSort.card) return;
  const card = sectionSort.card, grid = $('#sectionTimeGrid'), rect = card.getBoundingClientRect();
  sectionSort.active = true; sectionSort.originalOrder = getSectionCardOrder(); sectionSort.offsetX = sectionSort.lastX - rect.left; sectionSort.offsetY = sectionSort.lastY - rect.top;
  const placeholder = document.createElement('div'); placeholder.className = 'section-sort-placeholder'; placeholder.dataset.sectionName = card.dataset.sectionName; placeholder.style.height = `${rect.height}px`; sectionSort.placeholder = placeholder;
  grid.insertBefore(placeholder, card); document.body.appendChild(card);
  Object.assign(card.style, { position: 'fixed', left: '0px', top: '0px', width: `${rect.width}px`, height: `${rect.height}px`, margin: '0px', transform: `translate3d(${rect.left}px,${rect.top}px,0) scale(1.025)` });
  sectionSort.card.classList.remove('holding'); sectionSort.card.classList.add('dragging');
  grid.classList.add('sorting'); document.body.classList.add('section-reordering');
  if (sectionSort.inputType === 'pointer' && sectionSort.pointerId !== null) { try { sectionSort.card.setPointerCapture(sectionSort.pointerId); } catch {} }
  if (navigator.vibrate) navigator.vibrate(30);
  renderPacingOrderNote('正在调整：拖到目标位置后松开');
}
function beginSectionSort(card, x, y, inputType, id) {
  resetSectionSortState();
  Object.assign(sectionSort, { card, inputType, startX: x, startY: y, lastX: x, lastY: y, pointerId: inputType === 'pointer' ? id : null, touchId: inputType === 'touch' ? id : null });
  if (inputType === 'pointer') { try { card.setPointerCapture(id); } catch {} }
  card.classList.add('holding'); sectionSort.timer = setTimeout(activateSectionSort, 460);
}
function moveSectionSort(x, y, event) {
  if (!sectionSort.card) return;
  if (!sectionSort.active) {
    sectionSort.lastX = x; sectionSort.lastY = y;
    if (Math.hypot(x - sectionSort.startX, y - sectionSort.startY) > 10) resetSectionSortState();
    return;
  }
  if (event.cancelable) event.preventDefault(); positionFloatingSectionCard(x, y);
  const target = document.elementFromPoint(x, y)?.closest('[data-section-card]');
  if (!target || !$('#sectionTimeGrid').contains(target)) return;
  const grid = $('#sectionTimeGrid'), children = [...grid.children], from = children.indexOf(sectionSort.placeholder), to = children.indexOf(target);
  if (from < 0 || to < 0 || Math.abs(from - to) < 1) return;
  animateSectionGridReflow(() => grid.insertBefore(sectionSort.placeholder, to > from ? target.nextSibling : target));
}
function finishSectionSort(cancelled = false) {
  if (!sectionSort.card) return;
  const wasActive = sectionSort.active, originalOrder = [...sectionSort.originalOrder];
  if (!wasActive) { resetSectionSortState(); renderPacingOrderNote(); return; }
  const card = sectionSort.card, placeholder = sectionSort.placeholder, floatingRect = card.getBoundingClientRect();
  placeholder.parentNode.insertBefore(card, placeholder); placeholder.remove(); sectionSort.placeholder = null; clearSectionFloatingStyles(card); card.classList.remove('dragging');
  if (cancelled) reorderSectionCards(originalOrder);
  const settledRect = card.getBoundingClientRect(), x = floatingRect.left - settledRect.left, y = floatingRect.top - settledRect.top;
  card.animate([{ transform: `translate3d(${x}px,${y}px,0) scale(1.025)`, opacity: .94 }, { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.85,.2,1)' });
  const order = cancelled ? null : getSectionCardOrder();
  resetSectionSortState();
  if (!order) { renderPacingOrderNote(); return; }
  state.settings.sectionOrder = normalizeSectionOrder(order); applySectionOrder(); state.pacingNotified = []; saveSettings();
  renderPresets(); render(); renderPacingOrderNote(); showToast('模考节奏顺序已保存');
}
function formatClock(total) {
  total = Math.max(0, Math.round(total));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}
function formatShortClock(total) { const clock = formatClock(total); return total >= 3600 ? clock : clock.slice(3); }
function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
function formatAccuracy(correct, questions) {
  if (!Number.isFinite(correct) || !questions) return '暂无';
  const rate = (correct / questions) * 100;
  const rounded = Math.round(rate * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
function formatScore(score) {
  if (!Number.isFinite(score)) return '暂无';
  return `${Number.isInteger(score) ? score : score.toFixed(1)} 分`;
}
function parseDateKey(key) {
  const match = typeof key === 'string' ? key.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
function getTodayKey() { return getDateStamp(new Date()); }
function normalizeExamCountdown(countdown = {}) {
  const name = normalizeText(countdown.name, 24) || '公考笔试';
  const date = parseDateKey(countdown.date) ? countdown.date : '';
  const checkIns = Array.isArray(countdown.checkIns) ? [...new Set(countdown.checkIns.filter(key => parseDateKey(key)))].sort() : [];
  return { name, date, checkIns: checkIns.slice(-730) };
}
function getExamCountdown() {
  state.settings.examCountdown = normalizeExamCountdown(state.settings.examCountdown);
  return state.settings.examCountdown;
}
function getExamDaysLeft(dateKey) {
  const target = parseDateKey(dateKey), today = parseDateKey(getTodayKey());
  if (!target || !today) return null;
  return Math.round((target - today) / 86400000);
}
function getCheckinStreak(checkIns = getExamCountdown().checkIns) {
  const checked = new Set(checkIns), cursor = parseDateKey(getTodayKey());
  let streak = 0;
  while (cursor && checked.has(getDateStamp(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
function getExamCountdownStatus() {
  const countdown = getExamCountdown(), today = getTodayKey(), daysLeft = getExamDaysLeft(countdown.date), checkedToday = countdown.checkIns.includes(today), streak = getCheckinStreak(countdown.checkIns);
  return { countdown, today, daysLeft, checkedToday, streak, hasDate: daysLeft !== null };
}
function renderExamCountdown() {
  const status = getExamCountdownStatus(), { countdown, daysLeft, checkedToday, streak, hasDate } = status;
  const container = $('#examCountdown'), label = $('#examCountdownLabel'), days = $('#examCountdownDays'), meta = $('#examCountdownMeta'), checkin = $('#examCheckinBtn');
  if (!container) return;
  container.classList.toggle('unset', !hasDate);
  container.classList.toggle('urgent', hasDate && daysLeft >= 0 && daysLeft <= 30);
  container.classList.toggle('expired', hasDate && daysLeft < 0);
  label.textContent = hasDate ? `距离 ${countdown.name} 还有` : '考试倒计时';
  days.textContent = hasDate ? (daysLeft > 0 ? `${daysLeft} 天` : daysLeft === 0 ? '就是今天' : `已过 ${Math.abs(daysLeft)} 天`) : '设置考试日期';
  meta.textContent = hasDate ? `${checkedToday ? '今日已打卡' : '今日未打卡'} · 连续 ${streak} 天` : '填上目标，开始打卡';
  checkin.disabled = !hasDate || daysLeft < 0;
  checkin.textContent = checkedToday ? '已打卡' : '打卡';
  checkin.setAttribute('aria-pressed', String(checkedToday));
  syncExamCountdownInputs(status);
}
function syncExamCountdownInputs(status = getExamCountdownStatus()) {
  const { countdown, daysLeft, checkedToday, streak, hasDate } = status;
  const nameInput = $('#examNameInput'), dateInput = $('#examDateInput');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = countdown.name === '公考笔试' && !countdown.date ? '' : countdown.name;
  if (dateInput && document.activeElement !== dateInput) dateInput.value = countdown.date;
  const summary = $('#examSettingSummary'), checkin = $('#examSettingCheckin'), streakEl = $('#examSettingStreak'), note = $('#examCountdownNote'), settingsBtn = $('#settingsExamCheckinBtn');
  if (summary) summary.textContent = hasDate ? `${countdown.name} · ${daysLeft > 0 ? `还剩 ${daysLeft} 天` : daysLeft === 0 ? '就是今天' : `已过 ${Math.abs(daysLeft)} 天`}` : '未设置';
  if (checkin) checkin.textContent = checkedToday ? '今日已打卡' : '今日未打卡';
  if (streakEl) streakEl.textContent = `${streak} 天`;
  if (note) note.textContent = hasDate ? `考试日期：${countdown.date}。${daysLeft >= 0 ? '顶部会持续显示倒计时和打卡状态。' : '这场考试日期已过，可以改成下一场目标。'}` : '设置后会出现在顶部，越临近考试提示越明显。';
  if (settingsBtn) { settingsBtn.disabled = !hasDate || daysLeft < 0; settingsBtn.textContent = checkedToday ? '今日已打卡' : '今日打卡'; }
}
function saveExamCountdownSettings() {
  const nameInput = $('#examNameInput'), dateInput = $('#examDateInput'), existing = getExamCountdown(), name = normalizeText(nameInput.value, 24) || '公考笔试', date = dateInput.value;
  if (!parseDateKey(date)) { showToast('请选择有效的考试日期', 'warning'); dateInput.focus(); return; }
  state.settings.examCountdown = normalizeExamCountdown({ ...existing, name, date });
  saveSettings(); renderExamCountdown(); showToast('考试倒计时已保存');
}
function checkInExamCountdown() {
  const status = getExamCountdownStatus();
  if (!status.hasDate) { openExamCountdownSettings(); showToast('先设置考试日期', 'warning'); return; }
  if (status.daysLeft < 0) { openExamCountdownSettings(); showToast('考试日期已过，请设置下一场目标', 'warning'); return; }
  if (status.checkedToday) { showToast('今天已经打过卡了'); return; }
  state.settings.examCountdown = normalizeExamCountdown({ ...status.countdown, checkIns: [...status.countdown.checkIns, status.today] });
  saveSettings(); renderExamCountdown(); showToast('今日已打卡，坚持住');
}
function openExamCountdownSettings() {
  openDrawer($('#settingsDrawer'));
  setSettingsView('general');
  setTimeout(() => { ($('#examDateInput')?.value ? $('#examNameInput') : $('#examDateInput'))?.focus(); }, 80);
}
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
  state.preset = preset; state.duration = preset.seconds; resetTimer(false); renderPresets();
}

function setMode(mode) {
  if (mode === state.mode) return;
  stopInterval(); state.mode = mode; state.preset = PRESETS[mode][0]; state.duration = state.preset.seconds;
  resetTimer(false);
  $$('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
  $('#timerHint').textContent = mode === 'single'
    ? '每完成一题点击计时数字、打点按钮或按空格，自动记录逐题用时。'
    : mode === 'section' ? '按专项节奏完成，每做完一题可打点记录逐题用时。' : '按正式考试节奏完成，每做完一题可打点记录逐题用时。';
  renderPresets(); syncMobilePipSource(true);
}

function startOrPause() {
  if (state.status === 'running') { pauseTimer(); $('#startBtn').blur(); return; }
  unlockAudio(false);
  if (state.status === 'finished') resetTimer(false);
  state.status = 'running'; state.autoFinished = false;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.tickBase = { at: Date.now(), remaining: state.remaining, elapsed: state.elapsed };
  state.interval = setInterval(tick, 200); tick(); render(); syncNativeVideoTime(true); $('#startBtn').blur();
}

function pauseTimer() {
  tick(); stopInterval(); state.status = 'paused'; render(); syncNativeVideoTime(true);
}

function tick(skipPacing = false) {
  if (state.status !== 'running') return;
  const delta = Math.max(0, state.elapsed - state.tickBase.elapsed, (Date.now() - state.tickBase.at) / 1000);
  state.elapsed = state.tickBase.elapsed + delta;
  if (state.mode === 'single') state.remaining = 0;
  else {
    const rawRemaining = state.tickBase.remaining - delta;
    state.remaining = Math.max(0, rawRemaining);
    if (rawRemaining <= 0 && !state.autoFinished) { state.autoFinished = true; if (state.settings.sound) playBeep(); syncMobilePipSource(true); }
  }
  if (!skipPacing) checkMockPacing(); render(); updatePip();
}

function resetTimer(confirmNeeded = true) {
  if (confirmNeeded && state.elapsed >= 1 && !confirm('确定重置本轮计时吗？未结束的记录不会保存。')) return;
  stopInterval(); state.remaining = state.duration; state.elapsed = 0; state.startedAt = null; state.status = 'idle'; state.autoFinished = false; state.laps = []; state.lastLapElapsed = 0; state.pacingNotified = []; render(); updatePip(); syncMobilePipSource(true);
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
  render(); showToast(`第 ${number} 题已打点 · ${formatClock(lapDuration).slice(3)}`);
}

function undoLap() {
  if (!state.laps.length) return;
  const removed = state.laps.pop(); state.lastLapElapsed = state.laps.reduce((sum, value) => sum + value, 0);
  render(); $('#undoLapBtn').blur(); showToast(`已撤销上一题（${formatClock(removed).slice(3)}）`);
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
  pauseTimer();
  const lapQuestions = state.laps.length || null;
  if (state.mode === 'mock') { openCorrectInputDialog(lapQuestions, { papers: 1, score: true }); return; }
  if (state.preset.name === '数量关系' && !lapQuestions) { openQuantityChoiceDialog(); return; }
  openCorrectInputDialog(lapQuestions || SECTION_QUESTION_COUNTS[state.preset.name] || null);
}

function confirmFinish() {
  if (state.status === 'finished' && state.autoFinished) { $('#finishDialog').close(); resetFinishDialog(); return; }
  if (state.pendingTimed?.step === 'correct') saveTimedCorrectSession();
}

function openQuantityChoiceDialog() {
  $('#dialogTitle').textContent = '选择数量关系题量';
  $('#dialogMessage').textContent = `本次训练 ${formatDuration(state.elapsed)}，请选择本组数量关系题量。`;
  $('#scoreInputWrap').classList.add('hidden'); $('#questionInputWrap').classList.add('hidden'); $('#correctInputWrap').classList.add('hidden'); $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').classList.add('hidden');
  $('#quantityChoiceWrap').classList.remove('hidden'); $('#finishDialog').showModal();
}

function saveQuantitySession(questions) {
  $('#finishDialog').close(); resetFinishDialog(); openCorrectInputDialog(questions);
}

function openCorrectInputDialog(questions, options = {}) {
  if (!questions && !options.editableQuestions && !options.score) { beginTimedMeta({ questions: null, papers: null, correct: null, score: null }); return; }
  state.pendingTimed = { step: 'correct', questions, papers: options.papers ?? null, editableQuestions: Boolean(options.editableQuestions), score: Boolean(options.score) };
  $('#dialogTitle').textContent = options.score ? '填写本次分数' : (options.editableQuestions ? '填写本次正确率' : '填写正确数量');
  $('#dialogMessage').textContent = options.score ? `本次${state.preset.name} ${formatDuration(state.elapsed)}，请输入本次得分。` : (options.editableQuestions ? `本次${state.preset.name} ${formatDuration(state.elapsed)}，请输入完成题数和正确数量。` : `本次共 ${questions} 题，请输入做对的题数。`);
  $('#finishScore').value = '';
  $('#finishQuestionCount').value = questions ? String(questions) : '';
  $('#finishCorrectCount').max = questions ? String(questions) : '';
  $('#finishCorrectCount').value = questions ? String(questions) : '';
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
  const result = { questions, papers, correct, score };
  $('#finishDialog').close(); resetFinishDialog();
  if (state.pendingTimed.score && state.mode === 'mock' && state.preset.name === '行测模考') { openMockModuleReview(result); return; }
  state.pendingTimed = null; beginTimedMeta(result);
}

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
  const editingRecord = options.record || null;
  state.pendingTimed = { step: 'modules', result, modulePlan: editingRecord ? getMockReportRows(editingRecord) : getMockModuleReviewPlan(), editingRecordId: editingRecord?.id || null };
  const plan = state.pendingTimed.modulePlan;
  const dotted = plan.filter(item => item.duration !== null).length;
  const editing = Boolean(editingRecord);
  $('#mockModuleTitle').textContent = editing ? '修正模考模块数据' : '各模块做对多少题？';
  $('#mockModuleMessage').textContent = editing ? '修改后的正确数、总分和训练信息将更新原训练记录，并重新计算统计。' : '题量和时间目标取自当前专项配置。可只填写已核对的模块，完成逐题打点的模块会同时记录实际用时。';
  $('#mockModuleScoreWrap').classList.toggle('hidden', !editing); $('#mockModuleScore').value = editing && toScore(editingRecord.score) !== null ? String(toScore(editingRecord.score)) : '';
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
  state.pendingTimed = null; $('#mockModuleDialog').close();
  if (pending.editingRecordId) {
    const record = state.records.find(item => item.id === pending.editingRecordId); if (!record) return;
    state.pendingMeta = { context: 'mock-edit', recordId: record.id, result: { score, moduleResults }, previousMeta: normalizeTrainingMeta(record) };
    openTrainingMetaDialog('补充模考资料', state.pendingMeta.previousMeta); return;
  }
  beginTimedMeta({ ...pending.result, score, moduleResults });
}

function beginTimedMeta(result) {
  state.pendingMeta = { context: 'timed', result };
  openTrainingMetaDialog(`${state.preset.name} · 训练复盘`);
}

function finalizeTimedSession(questions, papers, correct = null, score = null, meta = {}, moduleResults = []) {
  const savedRecord = saveSession(questions, papers, correct, score, state.laps, meta, moduleResults);
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

function openTrainingMetaDialog(title, initialMeta = null) {
  resetTrainingMetaDialog(); $('#trainingMetaTitle').textContent = title;
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
    const { questions, papers, correct, score, moduleResults = [] } = pending.result;
    finalizeTimedSession(questions, papers, correct, score, meta, moduleResults);
  } else if (pending.context === 'speed') finalizeSpeedSession(pending.moduleName, meta);
  else if (pending.context === 'mock-edit') {
    const record = state.records.find(item => item.id === pending.recordId); if (!record) return;
    record.score = pending.result.score; record.moduleResults = normalizeModuleResults(pending.result.moduleResults); Object.assign(record, meta, { updatedAt: new Date().toISOString() });
    saveRecords(); renderStats(); showToast('模考报告已更新'); openMockReport(record.id);
  }
}

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
  state.records[index] = nextRecord;
  state.records.sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
  saveRecords();
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

function finishSpeedSession() {
  tick(); if (state.elapsed < .5) return;
  state.pendingSpeed = { duration: Math.round(state.elapsed), startedAt: state.startedAt, endedAt: new Date().toISOString(), laps: normalizeLaps(state.laps) };
  stopInterval(); state.status = 'paused'; render(); syncNativeVideoTime(true); openSpeedSaveDialog();
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
  session.moduleName = moduleName; $('#singleModulePicker').classList.add('hidden');
  if (SPEED_SCORE_TYPES.has(moduleName)) {
    session.step = 'score'; session.questions = session.laps.length || null; session.correct = null; session.papers = 1;
    configureSpeedStepper(true); $('#speedScore').value = ''; $('#speedScoreWrap').classList.remove('hidden'); $('#nextSpeedStepBtn').classList.remove('hidden');
    const lapText = session.laps.length ? `已自动记录 ${session.laps.length} 次逐题打点；` : '';
    updateSpeedDialogStep('score', { title: `填写${moduleName}成绩`, message: `${lapText}模考类型只需填写本次得分。`, nextLabel: '下一步：复盘' });
    $('#speedScore').focus(); return;
  }
  const lapCount = session.laps.length; session.step = 'questions'; session.papers = null;
  configureSpeedStepper(false); $('#speedQuestionCount').value = lapCount ? String(lapCount) : '1'; $('#speedQuestionCount').readOnly = lapCount > 0; $('#speedCountWrap').classList.remove('hidden'); $('#nextSpeedStepBtn').classList.remove('hidden');
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
  $('#speedCorrectCount').max = String(questions); $('#speedCorrectCount').value = ''; $('#speedCorrectCount').placeholder = `0 - ${questions}`;
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
  state.pendingMeta = { context: 'speed', moduleName: session.moduleName };
  $('#singleModuleDialog').close(); openTrainingMetaDialog(`${session.moduleName} · 训练复盘`);
}

function finalizeSpeedSession(moduleName, meta = {}) {
  const session = state.pendingSpeed; if (!session) return;
  const questions = session.questions || null, correct = session.correct ?? null, score = toScore(session.score), papers = session.papers ?? null;
  const savedRecord = { id: crypto.randomUUID?.() || `${Date.now()}`, mode: 'single', module: moduleName, duration: session.duration, planned: null, startedAt: session.startedAt, endedAt: session.endedAt, questions, papers, correct, score, laps: session.laps, lapReviews: [], ...normalizeTrainingMeta(meta) };
  state.records.unshift(savedRecord);
  state.records = state.records.slice(0, 500);
  const resultText = score !== null ? `分数 ${formatScore(score)}` : `${questions} 题，正确率 ${formatAccuracy(correct, questions)}`;
  const paceText = questions ? `，均时 ${formatClock(session.duration / questions).slice(3)}` : '';
  state.pendingSpeed = null; saveRecords(); $('#singleModuleDialog').close(); resetSpeedSaveDialog(); state.elapsed = 0; state.startedAt = null; state.status = 'idle'; state.laps = []; state.lastLapElapsed = 0; renderStats(); render(); syncMobilePipSource(true); showToast(`已记录到${moduleName}：${resultText}${paceText}`);
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

function saveSession(questions, papers = null, correct = null, score = null, laps = [], meta = {}, moduleResults = []) {
  if (state.elapsed < 1) return null;
  const savedRecord = { id: crypto.randomUUID?.() || `${Date.now()}`, mode: state.mode, module: state.preset.name, duration: Math.round(state.elapsed), planned: state.duration, startedAt: state.startedAt, endedAt: new Date().toISOString(), questions, papers, correct, score, laps: normalizeLaps(laps), lapReviews: [], moduleResults: normalizeModuleResults(moduleResults), ...normalizeTrainingMeta(meta) };
  state.records.unshift(savedRecord);
  state.records = state.records.slice(0, 500); saveRecords(); renderStats(); return savedRecord;
}

function render() {
  const isOvertime = state.mode !== 'single' && state.autoFinished;
  const displaySeconds = state.mode === 'single' ? state.elapsed : (isOvertime ? Math.max(0, state.elapsed - state.duration) : state.remaining);
  $('#timerDisplay').textContent = formatClock(displaySeconds);
  $('#sessionTitle').textContent = state.preset.name;
  const statuses = { idle: '准备开始', running: isOvertime ? '已超时' : '计时中', paused: isOvertime ? '超时暂停' : '已暂停', finished: '本轮结束' };
  $('#sessionStatus').textContent = statuses[state.status]; $('#statusDot').classList.toggle('running', state.status === 'running');
  $('.timer-stage').classList.toggle('paused', state.status === 'paused');
  $('#pauseOverlay').setAttribute('aria-hidden', state.status === 'paused' ? 'false' : 'true');
  const warning = state.mode !== 'single' && state.status === 'running' && !isOvertime && state.remaining > 0 && state.remaining <= state.settings.warning;
  $('#timerDisplay').classList.toggle('warning', warning); $('#timerDisplay').classList.toggle('overtime', isOvertime); $('#timerDisplay').classList.toggle('paused', state.status === 'paused');
  $('#startBtn').innerHTML = state.status === 'running' ? 'Ⅱ<span>暂停</span>' : `▶<span>${state.status === 'paused' ? '继续' : '开始'}</span>`;
  $('#finishBtn').innerHTML = state.mode === 'single' ? '✓<span>结束并保存</span>' : '■<span>结束</span>';
  $('#resetBtn').disabled = state.status === 'idle'; $('#finishBtn').disabled = state.status === 'idle';
  $$('.preset-button').forEach(el => el.disabled = state.status === 'running');
  renderLapPanel(); renderPacingStatus();
}

function getLapStats(laps) {
  const values = normalizeLaps(laps), total = values.reduce((sum, value) => sum + value, 0);
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const slowest = Math.max(...values), fastest = Math.min(...values);
  return { values, total, average: total / values.length, median, slowest, fastest, slowestIndex: values.indexOf(slowest) };
}

function getLapReviewDraftItem(index) {
  const review = state.lapReviewDraft[index];
  return review ? { status: review.status || null, reason: review.reason || null, note: review.note || '' } : { status: null, reason: null, note: '' };
}

function getLapReviewCounts(reviews, lapCount) {
  const counts = { correct: 0, wrong: 0, skipped: 0, reviewed: 0, reasons: {} };
  for (let index = 0; index < lapCount; index += 1) {
    const review = reviews[index];
    if (!review?.status) continue;
    counts[review.status] += 1; counts.reviewed += 1;
    if (review.status === 'wrong' && review.reason) counts.reasons[review.reason] = (counts.reasons[review.reason] || 0) + 1;
  }
  return counts;
}

function renderLapReviewInsights(stats) {
  const counts = getLapReviewCounts(state.lapReviewDraft, stats.values.length);
  $('#lapReviewProgress').textContent = `${counts.reviewed} / ${stats.values.length}`;
  const reasonSummary = LAP_ERROR_REASONS.filter(reason => counts.reasons[reason]).map(reason => `${reason} ${counts.reasons[reason]} 题`).join(' · ');
  const costlyWrong = stats.values.map((duration, index) => ({ duration, index, review: state.lapReviewDraft[index] })).filter(item => item.review?.status === 'wrong' && item.duration > stats.average);
  const resultSummary = counts.reviewed ? `正确 ${counts.correct} · 错误 ${counts.wrong} · 跳过 ${counts.skipped}` : '尚未标记，可直接关闭后稍后补录';
  const priorityQuestions = costlyWrong.slice(0, 8).map(item => `第 ${item.index + 1} 题`).join('、');
  const prioritySummary = costlyWrong.length ? `优先复盘：${priorityQuestions}${costlyWrong.length > 8 ? `等 ${costlyWrong.length} 题` : ''}（做错且超过平均用时）` : '';
  $('#lapReviewInsights').innerHTML = `<strong>${resultSummary}</strong>${reasonSummary ? `<span>错因：${reasonSummary}</span>` : ''}${prioritySummary ? `<span class="priority-review">${prioritySummary}</span>` : ''}`;
}

function renderLapReviewList(record, stats) {
  $('#lapDetailList').innerHTML = stats.values.map((duration, index) => {
    const review = getLapReviewDraftItem(index);
    const ratio = Math.min(100, Math.max(8, duration / stats.slowest * 100));
    const costlyWrong = review.status === 'wrong' && duration > stats.average;
    const marker = costlyWrong ? '<em class="costly">高耗错题</em>' : (index === stats.slowestIndex ? '<em>最慢</em>' : (duration === stats.fastest ? '<em class="fast">最快</em>' : ''));
    const statusButtons = [['correct', '✓ 正确'], ['wrong', '× 错误'], ['skipped', '— 跳过']].map(([status, label]) => `<button type="button" data-review-status="${status}" aria-pressed="${review.status === status}">${label}</button>`).join('');
    const reasonButtons = LAP_ERROR_REASONS.map(reason => `<button type="button" data-review-reason="${reason}" aria-pressed="${review.reason === reason}">${reason}</button>`).join('');
    const fields = review.status ? `<div class="lap-review-fields">${review.status === 'wrong' ? `<div class="lap-reason-choices" aria-label="第 ${index + 1} 题错因"><small>错因（可选）</small><div>${reasonButtons}</div></div>` : ''}<label><span>本题备注（可选）</span><input data-review-note type="text" maxlength="120" value="${escapeAttribute(review.note)}" placeholder="记录思路、陷阱或下次注意事项"></label></div>` : '';
    return `<article class="lap-review-card${costlyWrong ? ' costly-wrong' : ''}" data-review-index="${index}"><div class="lap-detail-row"><span>第 ${index + 1} 题</span><div><i style="width:${ratio}%"></i></div><strong>${formatClock(duration).slice(3)}</strong>${marker}</div><div class="lap-status-choices" aria-label="第 ${index + 1} 题作答结果">${statusButtons}</div>${fields}</article>`;
  }).join('');
  renderLapReviewInsights(stats);
}

function openLapDetail(recordId) {
  const record = state.records.find(item => item.id === recordId), stats = getLapStats(record?.laps);
  if (!record || !stats) return;
  state.reviewingRecordId = record.id;
  const existingReviews = normalizeLapReviews(record.lapReviews, stats.values.length);
  state.lapReviewDraft = Array.from({ length: stats.values.length }, (_, index) => {
    const review = existingReviews[index];
    return review ? { ...review } : null;
  });
  const score = toScore(record.score);
  const resultText = score !== null ? `得分 ${formatScore(score)}` : (record.correct !== null && record.correct !== undefined ? `正确 ${record.correct}/${record.questions ?? stats.values.length} 题` : `已打点 ${stats.values.length} 题`);
  $('#lapDetailTitle').textContent = `${record.module} · 逐题表现`;
  $('#lapDetailMessage').textContent = `${resultText} · 中位数 ${formatClock(stats.median).slice(3)} · 最快 ${formatClock(stats.fastest).slice(3)}`;
  $('#lapDetailCount').textContent = `${stats.values.length} 题`;
  $('#lapDetailAverage').textContent = formatClock(stats.average).slice(3);
  $('#lapDetailSlowest').textContent = `第 ${stats.slowestIndex + 1} 题 · ${formatClock(stats.slowest).slice(3)}`;
  renderLapReviewList(record, stats); $('#lapDetailList').scrollTop = 0;
  const metaParts = [record.source ? `来源：${record.source}` : '', record.difficulty ? `难度：${record.difficulty}` : ''].filter(Boolean);
  $('#lapTrainingMeta').classList.toggle('hidden', !metaParts.length && !record.note);
  $('#lapTrainingMetaSummary').textContent = metaParts.join(' · ');
  $('#lapTrainingNote').textContent = record.note ? `“${record.note}”` : '';
  if (!$('#lapDetailDialog').open) $('#lapDetailDialog').showModal();
}

function closeLapDetail() {
  state.reviewingRecordId = null; state.lapReviewDraft = []; $('#lapDetailDialog').close();
}

function updateLapReviewFromClick(event) {
  const button = event.target.closest('[data-review-status],[data-review-reason]'); if (!button) return;
  const card = button.closest('[data-review-index]'), index = Number(card?.dataset.reviewIndex);
  const record = state.records.find(item => item.id === state.reviewingRecordId), stats = getLapStats(record?.laps);
  if (!Number.isInteger(index) || !record || !stats) return;
  const review = getLapReviewDraftItem(index);
  if (button.dataset.reviewStatus) {
    const status = button.dataset.reviewStatus;
    if (review.status === status) {
      state.lapReviewDraft[index] = null;
      const scrollTop = $('#lapDetailList').scrollTop; renderLapReviewList(record, stats); $('#lapDetailList').scrollTop = scrollTop; return;
    }
    review.status = status;
    if (review.status !== 'wrong') review.reason = null;
  } else if (review.status === 'wrong') review.reason = review.reason === button.dataset.reviewReason ? null : button.dataset.reviewReason;
  state.lapReviewDraft[index] = review.status || review.reason || review.note ? review : null;
  const scrollTop = $('#lapDetailList').scrollTop; renderLapReviewList(record, stats); $('#lapDetailList').scrollTop = scrollTop;
}

function updateLapReviewNote(event) {
  const input = event.target.closest('[data-review-note]'); if (!input) return;
  const index = Number(input.closest('[data-review-index]')?.dataset.reviewIndex); if (!Number.isInteger(index)) return;
  const review = getLapReviewDraftItem(index); review.note = input.value.slice(0, 120);
  state.lapReviewDraft[index] = review.status || review.reason || review.note.trim() ? review : null;
}

function saveLapReviews() {
  const record = state.records.find(item => item.id === state.reviewingRecordId), stats = getLapStats(record?.laps); if (!record || !stats) return;
  record.lapReviews = normalizeLapReviews(state.lapReviewDraft, stats.values.length);
  const counts = getLapReviewCounts(record.lapReviews, stats.values.length);
  saveRecords(); renderStats(); closeLapDetail();
  showToast(counts.reviewed ? `逐题复盘已保存：已标记 ${counts.reviewed}/${stats.values.length} 题` : '记录已保留，可稍后在历史记录中补充逐题复盘');
}

function getPeriodRecords(days, offset = 0, now = new Date()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999); end.setDate(end.getDate() - days * offset);
  const start = new Date(end); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - days + 1);
  return state.records.filter(record => { const date = new Date(record.endedAt); return Number.isFinite(date.getTime()) && date >= start && date <= end; });
}

function getDayKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }

function getModuleAnalytics(records, moduleName) {
  const directRows = records.filter(record => record.module === moduleName);
  const mockModuleRows = records.flatMap(record => normalizeModuleResults(record.moduleResults).filter(result => result.module === moduleName && (result.correct !== null || result.duration !== null)).map(result => ({ ...result, id: `${record.id}:${result.module}`, endedAt: record.endedAt, source: record.source, difficulty: record.difficulty })));
  const rows = [...directRows, ...mockModuleRows], questionRows = rows.filter(record => toPositiveInt(record.questions));
  const questions = questionRows.reduce((sum, record) => sum + toPositiveInt(record.questions), 0);
  const correct = questionRows.reduce((sum, record) => sum + (toNonNegativeInt(record.correct) ?? 0), 0);
  const accuracyQuestions = questionRows.filter(record => toNonNegativeInt(record.correct) !== null).reduce((sum, record) => sum + toPositiveInt(record.questions), 0);
  const accuracyCorrect = questionRows.filter(record => toNonNegativeInt(record.correct) !== null).reduce((sum, record) => sum + toNonNegativeInt(record.correct), 0);
  const timedRows = questionRows.filter(record => Number.isFinite(record.duration) && record.duration > 0);
  const pacedQuestions = timedRows.reduce((sum, record) => sum + record.questions, 0);
  const pace = pacedQuestions ? timedRows.reduce((sum, record) => sum + record.duration, 0) / pacedQuestions : null;
  const paces = timedRows.map(record => record.duration / record.questions).filter(Number.isFinite);
  const mean = paces.length ? paces.reduce((sum, value) => sum + value, 0) / paces.length : null;
  const deviation = paces.length >= 3 ? Math.sqrt(paces.reduce((sum, value) => sum + (value - mean) ** 2, 0) / paces.length) : null;
  const stability = deviation !== null && mean ? deviation / mean : null;
  return { rows, sessions: rows.length, questions, correct, pace, paces, stability, accuracy: accuracyQuestions ? accuracyCorrect / accuracyQuestions * 100 : null, accuracyQuestions };
}

function getStabilityLabel(value, samples) {
  if (samples < 3 || value === null) return '待积累';
  if (value <= .15) return '稳定';
  if (value <= .3) return '有波动';
  return '波动较大';
}

function getWeaknessScore(stats, targetPace) {
  if (stats.sessions < 2 || stats.questions < 5) return -1;
  let score = 0;
  if (stats.accuracy !== null && stats.accuracyQuestions >= 10) score += Math.max(0, 80 - stats.accuracy) * 1.6;
  if (stats.pace && targetPace) score += Math.max(0, stats.pace / targetPace - 1) * 60;
  if (stats.stability !== null) score += Math.max(0, stats.stability - .25) * 40;
  return score;
}

function getModuleAdvice(stats, previous, targetPace) {
  const parts = [];
  if (stats.accuracy !== null && stats.accuracyQuestions >= 10 && stats.accuracy < 75) parts.push(`正确率 ${formatAccuracy(stats.accuracy, 100)}，先稳住正确率`);
  else if (stats.pace && targetPace && stats.pace > targetPace * 1.15) parts.push(`题均比时间目标慢 ${Math.round((stats.pace / targetPace - 1) * 100)}%`);
  else if (stats.stability !== null && stats.stability > .3) parts.push('近期用时波动较大');
  else parts.push('近期节奏较稳定');
  if (stats.pace && previous.pace && previous.questions >= 5) {
    const delta = (stats.pace / previous.pace - 1) * 100;
    if (Math.abs(delta) >= 5) parts.push(`较前期${delta < 0 ? '快' : '慢'} ${Math.abs(Math.round(delta))}%`);
  }
  if (stats.accuracy !== null && previous.accuracy !== null && stats.accuracyQuestions >= 10 && previous.accuracyQuestions >= 10) {
    const delta = stats.accuracy - previous.accuracy;
    if (Math.abs(delta) >= 3) parts.push(`正确率较前期${delta > 0 ? '提升' : '下降'} ${Math.abs(Math.round(delta))} 个百分点`);
  }
  return parts.join(' · ');
}

function createTrendTotals(records = []) {
  return records.reduce((totals, record) => {
    totals.duration += Number(record.duration) || 0; totals.count += 1;
    const questions = toPositiveInt(record.questions), correct = toNonNegativeInt(record.correct), score = toScore(record.score);
    if (questions) { totals.questions += questions; totals.questionSessions += 1; }
    if (questions && correct !== null) { totals.accuracyQuestions += questions; totals.correct += Math.min(correct, questions); }
    if (score !== null) { totals.scoreTotal += score; totals.scoreCount += 1; }
    return totals;
  }, { duration: 0, count: 0, questions: 0, questionSessions: 0, accuracyQuestions: 0, correct: 0, scoreTotal: 0, scoreCount: 0 });
}

function getTrendValue(totals, metric) {
  if (metric === 'duration') return { value: totals.duration, hasData: totals.count > 0 };
  if (metric === 'questions') return { value: totals.questions, hasData: totals.questionSessions > 0 };
  if (metric === 'accuracy') return { value: totals.accuracyQuestions ? totals.correct / totals.accuracyQuestions * 100 : 0, hasData: totals.accuracyQuestions > 0 };
  return { value: totals.scoreCount ? totals.scoreTotal / totals.scoreCount : 0, hasData: totals.scoreCount > 0 };
}

function formatTrendValue(metric, value) {
  if (metric === 'duration') return formatDuration(value);
  if (metric === 'questions') return `${Math.round(value)} 题`;
  if (metric === 'accuracy') return `${Math.round(value * 10) / 10}%`;
  return formatScore(value);
}

function renderTrendSummary(metric, totals, currentMetric, activeDays) {
  if (metric === 'duration') $('#trendSummary').innerHTML = `<span><small>训练</small><strong>${totals.count} 次</strong></span><span><small>累计</small><strong>${formatDuration(totals.duration)}</strong></span><span><small>活跃</small><strong>${activeDays} 天</strong></span>`;
  else if (metric === 'questions') $('#trendSummary').innerHTML = `<span><small>刷题</small><strong>${totals.questions} 题</strong></span><span><small>训练</small><strong>${totals.questionSessions} 次</strong></span><span><small>活跃</small><strong>${activeDays} 天</strong></span>`;
  else if (metric === 'accuracy') $('#trendSummary').innerHTML = `<span><small>正确率</small><strong>${currentMetric.hasData ? formatTrendValue(metric, currentMetric.value) : '暂无'}</strong></span><span><small>答对</small><strong>${totals.correct}/${totals.accuracyQuestions || 0}</strong></span><span><small>有效</small><strong>${activeDays} 天</strong></span>`;
  else $('#trendSummary').innerHTML = `<span><small>平均分</small><strong>${currentMetric.hasData ? formatTrendValue(metric, currentMetric.value) : '暂无'}</strong></span><span><small>模考</small><strong>${totals.scoreCount} 次</strong></span><span><small>有效</small><strong>${activeDays} 天</strong></span>`;
}

function renderTrendBars(buckets, days, metric, metricName) {
  const maxValue = metric === 'accuracy' || metric === 'score' ? 100 : Math.max(...buckets.map(bucket => bucket.metric.value), 1), hasAnyData = buckets.some(bucket => bucket.metric.hasData);
  $('#trendChart').dataset.visual = 'bar';
  $('#trendChart').innerHTML = `<div class="trend-bars days-${days} metric-${metric}">${buckets.map((bucket, index) => {
    const ratio = bucket.metric.hasData ? Math.max(3, bucket.metric.value / maxValue * 100) : 0;
    const showLabel = days === 7 || index === 0 || index === days - 1 || (index % 7 === 0 && index < days - 2), label = `${bucket.date.getMonth() + 1}/${bucket.date.getDate()}`;
    const detail = metric === 'accuracy' ? `${formatTrendValue(metric, bucket.metric.value)} · ${bucket.totals.accuracyQuestions} 题` : metric === 'score' ? `${formatTrendValue(metric, bucket.metric.value)} · ${bucket.totals.scoreCount} 次` : formatTrendValue(metric, bucket.metric.value);
    return `<div class="trend-day${bucket.metric.hasData ? '' : ' no-data'}" title="${escapeAttribute(`${label} · ${bucket.metric.hasData ? detail : '暂无数据'}`)}"><div class="trend-bar-track"><i style="height:${ratio}%"></i></div><small>${showLabel ? label : ''}</small></div>`;
  }).join('')}</div>${hasAnyData ? '' : `<div class="trend-empty-overlay">最近 ${days} 天暂无${metricName}数据</div>`}`;
}

function getTrendComposition(records, metric) {
  if (metric === 'accuracy') {
    const totals = createTrendTotals(records); if (!totals.accuracyQuestions) return [];
    return [{ label: '做对', value: totals.correct }, { label: '做错', value: totals.accuracyQuestions - totals.correct }].filter(item => item.value > 0);
  }
  if (metric === 'score') {
    const bands = [{ label: '80 分及以上', value: 0 }, { label: '70-79 分', value: 0 }, { label: '60-69 分', value: 0 }, { label: '60 分以下', value: 0 }];
    records.map(record => toScore(record.score)).filter(Number.isFinite).forEach(score => { bands[score >= 80 ? 0 : score >= 70 ? 1 : score >= 60 ? 2 : 3].value += 1; });
    return bands.filter(item => item.value > 0);
  }
  const values = new Map();
  records.forEach(record => {
    const value = metric === 'duration' ? Number(record.duration) || 0 : toPositiveInt(record.questions) || 0;
    if (value > 0) values.set(record.module || '未分类', (values.get(record.module || '未分类') || 0) + value);
  });
  return [...values].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function renderTrendDonut(records, metric, metricName, days) {
  const segments = getTrendComposition(records, metric), total = segments.reduce((sum, item) => sum + item.value, 0), chart = $('#trendChart');
  chart.dataset.visual = 'donut';
  if (!segments.length || !total) { chart.innerHTML = `<div class="trend-empty-overlay">最近 ${days} 天暂无${metricName}构成数据</div>`; return; }
  let progress = 0;
  const colored = segments.map((item, index) => {
    const start = progress, percent = item.value / total * 100; progress += percent;
    return { ...item, color: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length], start, end: progress, percent };
  }), gradient = colored.map(item => `${item.color} ${item.start}% ${item.end}%`).join(', ');
  const totalLabel = metric === 'duration' ? formatDuration(total) : metric === 'questions' ? `${total} 题` : metric === 'accuracy' ? `${total} 题` : `${total} 次`;
  chart.innerHTML = `<div class="composition-layout"><div class="donut-chart" style="background:conic-gradient(${gradient})"><div><strong>${totalLabel}</strong><small>${metric === 'accuracy' ? '作答结果' : metricName}</small></div></div><div class="composition-legend">${colored.map(item => `<div><i style="background:${item.color}"></i><span>${escapeHTML(item.label)}</span><strong>${metric === 'duration' ? formatDuration(item.value) : metric === 'questions' || metric === 'accuracy' ? `${item.value} 题` : `${item.value} 次`} · ${Math.round(item.percent)}%</strong></div>`).join('')}</div></div>`;
}

function getRadarModules(records) {
  return getOrderedSectionPresets().map(preset => {
    const stats = getModuleAnalytics(records, preset.name), questions = MOCK_PACING_QUESTION_COUNTS[preset.name] || SECTION_QUESTION_COUNTS[preset.name], targetPace = questions ? preset.seconds / questions : null;
    if (!stats.questions) return null;
    const parts = [];
    if (stats.pace && targetPace) parts.push({ value: Math.min(100, targetPace / stats.pace * 100), weight: .45 });
    if (stats.accuracy !== null) parts.push({ value: stats.accuracy, weight: .4 });
    if (stats.stability !== null) parts.push({ value: Math.max(0, Math.min(100, (0.5 - stats.stability) / .5 * 100)), weight: .15 });
    const weight = parts.reduce((sum, part) => sum + part.weight, 0), score = weight ? parts.reduce((sum, part) => sum + part.value * part.weight, 0) / weight : 0;
    return { name: preset.name, score, pace: stats.pace, targetPace, accuracy: stats.accuracy, stability: stats.stability };
  }).filter(Boolean);
}

function renderTrendRadar(records, days) {
  const modules = getRadarModules(records), chart = $('#trendChart'); chart.dataset.visual = 'radar';
  if (!modules.length) { chart.innerHTML = `<div class="trend-empty-overlay">最近 ${days} 天暂无专项训练数据</div>`; $('#trendSummary').innerHTML = `<span><small>覆盖专项</small><strong>0 个</strong></span><span><small>综合状态</small><strong>暂无</strong></span><span><small>达标专项</small><strong>0 个</strong></span>`; return; }
  const size = 280, cx = 140, cy = 132, radius = 83, pointAt = (index, distance) => { const angle = -Math.PI / 2 + index * Math.PI * 2 / modules.length; return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance]; }, polygon = (ratio) => modules.map((_, index) => pointAt(index, radius * ratio).join(',')).join(' '), area = modules.map((module, index) => pointAt(index, radius * module.score / 100).join(',')).join(' '), average = modules.reduce((sum, module) => sum + module.score, 0) / modules.length, reached = modules.filter(module => module.score >= 75).length;
  $('#trendSummary').innerHTML = `<span><small>覆盖专项</small><strong>${modules.length} 个</strong></span><span><small>综合状态</small><strong>${Math.round(average)} 分</strong></span><span><small>达标专项</small><strong>${reached} 个</strong></span>`;
  chart.innerHTML = `<div class="radar-layout"><svg class="radar-chart" viewBox="0 0 ${size} 260" role="img" aria-label="专项综合状态雷达图">${[.25, .5, .75, 1].map(level => `<polygon points="${polygon(level)}" class="radar-grid"></polygon>`).join('')}${modules.map((module, index) => { const [x, y] = pointAt(index, radius); const [labelX, labelY] = pointAt(index, radius + 22); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-axis"></line><text x="${labelX}" y="${labelY}" text-anchor="middle">${escapeHTML(module.name)}</text>`; }).join('')}<polygon points="${area}" class="radar-area"></polygon>${modules.map((module, index) => { const [x, y] = pointAt(index, radius * module.score / 100); return `<circle cx="${x}" cy="${y}" r="4" class="radar-point"><title>${escapeHTML(`${module.name} · 综合 ${Math.round(module.score)} 分`)}</title></circle>`; }).join('')}</svg><div class="radar-legend">${modules.map(module => `<div><strong>${escapeHTML(module.name)}</strong><span>综合 ${Math.round(module.score)} 分${module.accuracy !== null ? ` · 正确率 ${Math.round(module.accuracy)}%` : ''}</span></div>`).join('')}</div></div>`;
}

function renderTrainingTrend(now) {
  const days = state.analyticsDays, metric = state.trendMetric, visual = state.trendVisual, current = getPeriodRecords(days, 0, now), previous = getPeriodRecords(days, 1, now);
  const buckets = Array.from({ length: days }, (_, index) => {
    const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days + index + 1);
    return { date, key: getDayKey(date), records: [] };
  }), byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  current.forEach(record => { const bucket = byKey.get(getDayKey(new Date(record.endedAt))); if (bucket) bucket.records.push(record); });
  buckets.forEach(bucket => { bucket.totals = createTrendTotals(bucket.records); bucket.metric = getTrendValue(bucket.totals, metric); });
  const totals = createTrendTotals(current), previousTotals = createTrendTotals(previous), currentMetric = getTrendValue(totals, metric), previousMetric = getTrendValue(previousTotals, metric), activeDays = buckets.filter(bucket => bucket.metric.hasData).length, metricNames = { duration: '训练时长', questions: '刷题数量', accuracy: '正确率', score: '模考成绩' }, metricName = metricNames[metric], visualNames = { bar: '按日变化', donut: '结构占比', radar: '专项综合' };
  $('#trendMetricSwitch').classList.toggle('hidden', visual === 'radar');
  if (!currentMetric.hasData) $('#trendPeriodSummary').textContent = `最近 ${days} 天 · 暂无${metricName}数据 · ${visualNames[visual]}`;
  else if (!previousMetric.hasData) $('#trendPeriodSummary').textContent = `最近 ${days} 天 · 暂无上一周期基准 · ${visualNames[visual]}`;
  else if (metric === 'accuracy' || metric === 'score') {
    const delta = currentMetric.value - previousMetric.value, unit = metric === 'accuracy' ? ' 个百分点' : ' 分';
    $('#trendPeriodSummary').textContent = `${Math.abs(delta) < .1 ? `最近 ${days} 天 · 与前期基本持平` : `最近 ${days} 天 · 较前期${delta > 0 ? '提升' : '下降'} ${Math.abs(Math.round(delta * 10) / 10)}${unit}`} · ${visualNames[visual]}`;
  } else {
    const delta = (currentMetric.value / previousMetric.value - 1) * 100;
    $('#trendPeriodSummary').textContent = `最近 ${days} 天 · 较前期${delta >= 0 ? '增加' : '减少'} ${Math.abs(Math.round(delta))}% · ${visualNames[visual]}`;
  }
  if (visual === 'radar') $('#trendPeriodSummary').textContent = `最近 ${days} 天 · 速度、正确率与稳定性 · 专项综合`;
  renderTrendSummary(metric, totals, currentMetric, activeDays);
  if (visual === 'donut') renderTrendDonut(current, metric, metricName, days);
  else if (visual === 'radar') renderTrendRadar(current, days);
  else renderTrendBars(buckets, days, metric, metricName);
}

function renderModuleBaselines(now) {
  const days = state.analyticsDays, current = getPeriodRecords(days, 0, now), previous = getPeriodRecords(days, 1, now);
  const analytics = PRESETS.section.map(preset => {
    const stats = getModuleAnalytics(current, preset.name), previousStats = getModuleAnalytics(previous, preset.name);
    const targetQuestions = MOCK_PACING_QUESTION_COUNTS[preset.name] || SECTION_QUESTION_COUNTS[preset.name], targetPace = targetQuestions ? preset.seconds / targetQuestions : null;
    return { preset, stats, previousStats, targetPace, weakness: getWeaknessScore(stats, targetPace) };
  });
  const sufficient = analytics.filter(item => item.weakness >= 0).sort((a, b) => b.weakness - a.weakness), priority = sufficient[0]?.weakness >= 8 ? sufficient[0].preset.name : null;
  $('#baselineList').innerHTML = sufficient.length ? sufficient.map(item => {
    const { preset, stats, previousStats, targetPace } = item, paceGoal = stats.pace && targetPace ? (stats.pace <= targetPace ? '达到目标' : `慢 ${Math.round((stats.pace / targetPace - 1) * 100)}%`) : '暂无目标对比';
    return `<article class="baseline-card${preset.name === priority ? ' priority' : ''}"><div class="baseline-heading"><strong>${preset.name}</strong>${preset.name === priority ? '<em>优先提升</em>' : ''}<span>${stats.sessions} 次 · ${stats.questions} 题</span></div><div class="baseline-metrics"><span><small>题均</small><strong>${stats.pace ? formatClock(stats.pace).slice(3) : '暂无'}</strong><i>${paceGoal}</i></span><span><small>正确率</small><strong>${stats.accuracy !== null ? formatAccuracy(stats.accuracy, 100) : '暂无'}</strong><i>${stats.accuracyQuestions} 题样本</i></span><span><small>稳定性</small><strong>${getStabilityLabel(stats.stability, stats.paces.length)}</strong><i>${stats.paces.length} 次样本</i></span></div><p>${getModuleAdvice(stats, previousStats, targetPace)}</p></article>`;
  }).join('') : '<div class="analytics-empty">每个专项至少完成 2 次且累计 5 题后，才会生成个人基准。</div>';
  const insufficient = analytics.filter(item => item.weakness < 0 && item.stats.sessions).map(item => item.preset.name);
  $('#baselineDataNote').classList.toggle('hidden', !insufficient.length || !sufficient.length);
  $('#baselineDataNote').textContent = insufficient.length ? `仍需积累：${insufficient.join('、')}（至少 2 次且累计 5 题）` : '';
}

function renderReasonTrends(now) {
  const records = getPeriodRecords(state.analyticsDays, 0, now), counts = Object.fromEntries(LAP_ERROR_REASONS.map(reason => [reason, 0]));
  let wrong = 0;
  records.forEach(record => normalizeLapReviews(record.lapReviews, normalizeLaps(record.laps).length).forEach(review => {
    if (review?.status !== 'wrong') return; wrong += 1; if (review.reason) counts[review.reason] += 1;
  }));
  const ranked = LAP_ERROR_REASONS.filter(reason => counts[reason]).sort((a, b) => counts[b] - counts[a]), max = Math.max(...ranked.map(reason => counts[reason]), 1), reasonTotal = ranked.reduce((sum, reason) => sum + counts[reason], 0);
  $('#reasonTrendList').innerHTML = ranked.length ? `<p class="reason-insight">最常见错因：<strong>${ranked[0]}</strong> · ${counts[ranked[0]]} 题</p>${ranked.map(reason => `<div class="reason-trend-row"><span>${reason}</span><div><i style="width:${counts[reason] / max * 100}%"></i></div><strong>${counts[reason]} 题 · ${Math.round(counts[reason] / reasonTotal * 100)}%</strong></div>`).join('')}` : `<div class="analytics-empty">${wrong ? `已标记 ${wrong} 道错题，但尚未填写具体错因。` : '完成逐题错误标记后，这里会汇总具体错因。'}</div>`;
}

function getHistoryBenchmark(record) {
  const endedAt = new Date(record.endedAt).getTime(); if (!Number.isFinite(endedAt)) return '';
  const prior = state.records.filter(item => item.id !== record.id && item.module === record.module && new Date(item.endedAt).getTime() < endedAt).sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt)).slice(0, 30);
  const parts = [], score = toScore(record.score), priorScores = prior.map(item => toScore(item.score)).filter(Number.isFinite);
  if (score !== null && priorScores.length >= 3) {
    const average = priorScores.reduce((sum, value) => sum + value, 0) / priorScores.length, delta = score - average;
    parts.push(Math.abs(delta) < 1 ? '成绩接近个人均分' : `较个人均分 ${delta > 0 ? '+' : ''}${delta.toFixed(1)} 分`);
  } else if (hasAccuracy(record)) {
    const priorAccuracy = getAccuracyTotals(prior), current = record.correct / record.questions * 100, baseline = priorAccuracy.questions ? priorAccuracy.correct / priorAccuracy.questions * 100 : null;
    if (baseline !== null && priorAccuracy.questions >= 10) { const delta = current - baseline; parts.push(Math.abs(delta) < 2 ? '正确率接近个人基准' : `正确率较基准 ${delta > 0 ? '+' : ''}${Math.round(delta)} 个百分点`); }
  }
  if (record.questions) {
    const paceRows = prior.filter(item => item.questions).slice(0, 20);
    if (paceRows.length >= 3) {
      const baseline = paceRows.reduce((sum, item) => sum + item.duration, 0) / paceRows.reduce((sum, item) => sum + item.questions, 0), delta = (record.duration / record.questions / baseline - 1) * 100;
      parts.push(Math.abs(delta) < 3 ? '速度接近个人基准' : `比个人均速${delta < 0 ? '快' : '慢'} ${Math.abs(Math.round(delta))}%`);
    }
  }
  return parts.slice(0, 2).join(' · ');
}

function renderPersonalAnalytics(now) {
  $$('[data-analytics-days]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.analyticsDays) === state.analyticsDays)));
  $$('[data-trend-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.trendMetric === state.trendMetric)));
  $$('[data-trend-visual]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.trendVisual === state.trendVisual)));
  $('#baselinePeriodSummary').textContent = `最近 ${state.analyticsDays} 天 · 速度 / 正确率 / 稳定性`;
  $('#reasonPeriodSummary').textContent = `最近 ${state.analyticsDays} 天 · 仅统计逐题错误标记`;
  renderTrainingTrend(now); renderModuleBaselines(now); renderReasonTrends(now);
}

function setStatsView(view, shouldScroll = true) {
  const views = ['overview', 'trend', 'baseline', 'reasons', 'history'];
  state.statsView = views.includes(view) ? view : 'overview';
  $$('[data-stats-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.statsView === state.statsView)));
  $$('[data-stats-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.statsPanel !== state.statsView));
  if (shouldScroll && $('#statsDrawer').classList.contains('open')) $('#statsDrawer').scrollTo({ top: 0, behavior: 'smooth' });
}

function setSettingsView(view, shouldScroll = true) {
  const views = ['general', 'pacing', 'shortcuts', 'data'];
  state.settingsView = views.includes(view) ? view : 'general';
  $$('[data-settings-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.settingsView === state.settingsView)));
  $$('[data-settings-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.settingsPanel !== state.settingsView));
  if (shouldScroll && $('#settingsDrawer').classList.contains('open')) $('#settingsDrawer').scrollTo({ top: 0, behavior: 'smooth' });
}

function openStatsDrawer() { renderStats(); setStatsView(state.statsView, false); openDrawer($('#statsDrawer')); }
function openSettingsDrawer(view = state.settingsView) { setSettingsView(view, false); openDrawer($('#settingsDrawer')); }

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
    return `<div class="history-row" data-record-id="${escapeAttribute(r.id)}"><button class="history-edit-trigger" data-edit-record-id="${escapeAttribute(r.id)}" type="button" aria-label="修改${escapeAttribute(r.module)}记录"><span class="history-main"><strong>${escapeHTML(r.module)}</strong><span class="history-meta">${new Date(r.endedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}${r.papers ? ` · ${r.papers} 套` : ''}${scoreText}${r.questions ? ` · ${r.questions} 题 · 题均 ${formatClock(r.duration/r.questions).slice(3)}` : ''}${accuracyText}</span>${benchmarkHtml}${metaHtml}</span><span class="history-side"><strong class="history-duration">${formatClock(r.duration)}</strong><span>点击编辑</span></span></button><button class="delete-record" data-id="${escapeAttribute(r.id)}" title="删除记录">×</button>${reportLink || lapLink ? `<div class="history-record-actions">${reportLink}${lapLink}</div>` : ''}</div>`;
  }).join('') : `<div class="empty-state">${historyFilter ? '没有符合筛选条件的记录' : '完成一次训练后，记录会显示在这里'}</div>`;
  $$('.delete-record').forEach(btn => btn.addEventListener('click', () => { if (!confirm('确定删除这条训练记录吗？此操作无法撤销。')) return; state.records = state.records.filter(r => r.id !== btn.dataset.id); saveRecords(); renderStats(); }));
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
}

function exportData() {
  const blob = new Blob([JSON.stringify(buildExportData(), null, 2)], { type: 'application/json' });
  downloadBlob(blob, `公考计时器完整备份-${getDateStamp()}.gktimer`);
  showToast('备份文件已下载');
}

function formatExportDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

function normalizeImportedData(data) {
  if (Array.isArray(data)) return { settings: buildSettingsSnapshot(), records: normalizeRecords(data) };
  if (!data || typeof data !== 'object') throw new Error('文件格式不正确');
  const importedSettings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const importedConfiguration = data.configuration && typeof data.configuration === 'object' ? data.configuration : {};
  const importedRecords = Array.isArray(data.records) ? data.records : [];
  const section = importedSettings.customDurations?.section || importedConfiguration.sectionDurations || data.sectionDurations || {};
  const customDurations = { ...(importedSettings.customDurations || {}), section: {} };
  PRESETS.section.forEach(preset => {
    const seconds = Number(section[preset.name]);
    customDurations.section[preset.name] = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : preset.seconds;
  });
  const mergedSettings = { ...state.settings, ...importedSettings, customDurations };
  mergedSettings.sound = 'sound' in importedConfiguration ? importedConfiguration.sound !== false : mergedSettings.sound !== false;
  mergedSettings.pacing = 'pacing' in importedConfiguration ? importedConfiguration.pacing !== false : mergedSettings.pacing !== false;
  mergedSettings.shortcuts = 'shortcuts' in importedConfiguration ? importedConfiguration.shortcuts !== false : mergedSettings.shortcuts !== false;
  mergedSettings.focusSound = normalizeFocusSoundSettings(importedSettings.focusSound || importedConfiguration.focusSound || mergedSettings.focusSound);
  mergedSettings.dark = 'dark' in importedConfiguration ? Boolean(importedConfiguration.dark) : Boolean(mergedSettings.dark);
  const fontSize = Number(importedSettings.fontSize ?? importedConfiguration.fontSize ?? mergedSettings.fontSize);
  const warning = Number(importedSettings.warning ?? importedConfiguration.warning ?? mergedSettings.warning);
  mergedSettings.fontSize = [0, 1, 2].includes(fontSize) ? fontSize : 1;
  mergedSettings.warning = Number.isFinite(warning) && warning > 0 ? warning : 60;
  mergedSettings.examCountdown = normalizeExamCountdown(importedSettings.examCountdown ?? mergedSettings.examCountdown);
  mergedSettings.sectionOrder = normalizeSectionOrder(importedSettings.sectionOrder || importedConfiguration.sectionOrder);
  return { settings: mergedSettings, records: normalizeRecords(importedRecords) };
}

function getRecordMergeKey(record) {
  const id = record?.id === null || record?.id === undefined ? '' : String(record.id).trim();
  if (id) return `id:${id}`;
  return `fallback:${[
    record?.mode, record?.module, record?.startedAt, record?.endedAt,
    record?.duration, record?.planned, record?.questions, record?.correct,
    record?.score, record?.papers
  ].map(value => String(value ?? '')).join('|')}`;
}

function getMergeableRecordCount(records) {
  const existingKeys = new Set(state.records.map(getRecordMergeKey));
  const incomingKeys = new Set();
  return records.filter(record => {
    const key = getRecordMergeKey(record);
    if (existingKeys.has(key) || incomingKeys.has(key)) return false;
    incomingKeys.add(key);
    return true;
  }).length;
}

function buildImportPreview(rawData, normalized, fileName = '') {
  const importedSettings = rawData && typeof rawData === 'object' && !Array.isArray(rawData) && rawData.settings && typeof rawData.settings === 'object' ? rawData.settings : {};
  const importedConfiguration = rawData && typeof rawData === 'object' && !Array.isArray(rawData) && rawData.configuration && typeof rawData.configuration === 'object' ? rawData.configuration : {};
  const sectionDurations = importedSettings.customDurations?.section || importedConfiguration.sectionDurations || rawData?.sectionDurations || {};
  const sectionOrder = importedSettings.sectionOrder || importedConfiguration.sectionOrder;
  const examCountdown = normalizeExamCountdown(importedSettings.examCountdown || {});
  return {
    fileName,
    appVersion: rawData?.appVersion || '未标注',
    exportedAt: rawData?.exportedAt || '',
    recordCount: normalized.records.length,
    mergeableRecordCount: getMergeableRecordCount(normalized.records),
    hasSettings: Boolean(Object.keys(importedSettings).length || Object.keys(importedConfiguration).length),
    hasExamCountdown: Boolean(examCountdown.date),
    hasSectionDurations: Boolean(sectionDurations && typeof sectionDurations === 'object' && Object.keys(sectionDurations).length),
    hasSectionOrder: Array.isArray(sectionOrder) && sectionOrder.length > 0
  };
}

function renderRestorePreview(preview) {
  $('#restorePreviewMessage').textContent = `${preview.fileName ? `文件：${preview.fileName}。` : ''}请选择一种恢复方式，操作前可以先查看下面的内容。`;
  const rows = [
    ['备份时间', preview.exportedAt ? formatExportDateTime(preview.exportedAt) : '未标注'],
    ['来自版本', preview.appVersion],
    ['训练记录', `${preview.recordCount} 条`],
    ['可合并记录', `${preview.mergeableRecordCount} 条`],
    ['个人设置', preview.hasSettings ? '包含' : '未发现'],
    ['考试倒计时', preview.hasExamCountdown ? '包含' : '未设置'],
    ['专项时间', preview.hasSectionDurations ? '包含' : '使用默认'],
    ['答题顺序', preview.hasSectionOrder ? '包含' : '使用默认']
  ];
  $('#restorePreviewDetails').innerHTML = rows.map(([label, value]) => `<span><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></span>`).join('');
  $('#restorePreviewWarning').innerHTML = `<strong>合并训练记录</strong>：预计新增 ${preview.mergeableRecordCount} 条，当前设置和已有记录不变。<br><strong>覆盖恢复</strong>：用备份中的设置和记录替换当前数据。`;
}

function restoreImportedData(data) {
  state.settings = data.settings; state.records = data.records;
  applyCustomDurations(); saveSettings(); saveRecords();
  if (state.mode === 'section') { const current = PRESETS.section.find(p => p.name === state.preset.name) || PRESETS.section[0]; state.preset = current; state.duration = current.seconds; resetTimer(false); }
  applySettings(); renderSectionTimeSettings(); renderPresets(); renderStats(); render(); renderDataManagementSummary();
}

function mergeImportedData(data) {
  const currentCount = state.records.length;
  const merged = normalizeRecords([...state.records, ...data.records]);
  const seen = new Set();
  state.records = merged.filter(record => {
    const key = getRecordMergeKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);
  saveRecords();
  renderStats(); renderDataManagementSummary();
  return Math.max(0, state.records.length - currentCount);
}

async function importDataFile(file) {
  if (!file) return;
  try {
    let rawData;
    try { rawData = JSON.parse(await file.text()); } catch { throw new Error('文件内容无法读取'); }
    const normalized = normalizeImportedData(rawData);
    state.pendingImport = normalized;
    renderRestorePreview(buildImportPreview(rawData, normalized, file.name));
    const dialog = $('#restorePreviewDialog');
    if (dialog.open) dialog.close();
    dialog.showModal();
    dialog.scrollTop = 0;
  } catch (error) { showToast(`恢复失败：${error.message}`); }
}

function confirmRestoreImport(mode = 'replace') {
  if (!state.pendingImport) { $('#restorePreviewDialog').close(); return; }
  const pendingImport = state.pendingImport;
  if (mode === 'merge') {
    const added = mergeImportedData(pendingImport);
    showToast(added ? `已合并 ${added} 条训练记录` : '没有发现新的训练记录');
  } else {
    restoreImportedData(pendingImport);
    showToast('备份已覆盖恢复');
  }
  state.pendingImport = null;
  $('#restorePreviewDialog').close();
}

function cancelRestoreImport() {
  state.pendingImport = null;
  $('#restorePreviewDialog').close();
}

const focusAudio = { ctx: null, source: null, gain: null, nodes: [], playing: false, type: null };

async function ensureAudioContext(showWarning = false) {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) { if (showWarning) showToast('当前浏览器不支持网页声音', 'warning'); return null; }
  if (!focusAudio.ctx) {
    try { focusAudio.ctx = new AudioCtor(); }
    catch { if (showWarning) showToast('浏览器阻止了声音初始化，请先点一下页面再试', 'warning'); return null; }
  }
  try { if (focusAudio.ctx.state === 'suspended') await focusAudio.ctx.resume(); } catch {}
  if (showWarning && focusAudio.ctx.state !== 'running') showToast('iOS 需要先点一下页面或测试音来解锁声音', 'warning');
  return focusAudio.ctx;
}

async function unlockAudio(showToastOnSuccess = false) {
  const ctx = await ensureAudioContext(showToastOnSuccess);
  if (!ctx || ctx.state !== 'running') return false;
  try {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    gain.gain.setValueAtTime(.0001, ctx.currentTime);
    osc.frequency.value = 440; osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + .025);
  } catch {}
  if (showToastOnSuccess) showToast('声音已解锁，若仍听不到请检查静音模式和媒体音量');
  return true;
}

function normalizeFocusSoundSettings(value = state.settings.focusSound) {
  const source = value && typeof value === 'object' ? value : {};
  const type = FOCUS_SOUND_TYPES[source.type] ? source.type : 'pink';
  const volume = Math.max(0, Math.min(100, Math.round(Number.isFinite(Number(source.volume)) ? Number(source.volume) : 28)));
  return { enabled: Boolean(source.enabled), type, volume };
}

function getFocusSoundGainValue(volume = normalizeFocusSoundSettings().volume) {
  return Math.pow(Math.max(0, Math.min(100, volume)) / 100, 1.8) * 0.28;
}

function createNoiseBuffer(ctx, type) {
  const length = Math.max(ctx.sampleRate * 3, 1), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (type === 'pink' || type === 'rain' || type === 'cafe') {
      b0 = .99886 * b0 + white * .0555179; b1 = .99332 * b1 + white * .0750759; b2 = .969 * b2 + white * .153852;
      b3 = .8665 * b3 + white * .3104856; b4 = .55 * b4 + white * .5329522; b5 = -.7616 * b5 - white * .016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * .5362) * .11; b6 = white * .115926;
    } else if (type === 'brown' || type === 'waves') {
      last = (last + .025 * white) / 1.025; data[i] = last * 3.2;
    } else data[i] = white * .48;
  }
  return buffer;
}

function addFocusFilter(ctx, input, filterType, frequency, q = .7) {
  const filter = ctx.createBiquadFilter();
  filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = q;
  input.connect(filter); focusAudio.nodes.push(filter); return filter;
}

async function startFocusSound(persist = true) {
  const settings = normalizeFocusSoundSettings({ ...state.settings.focusSound, enabled: true });
  stopFocusSound(false);
  const ctx = await ensureAudioContext(true);
  if (!ctx || ctx.state !== 'running') {
    state.settings.focusSound = { ...settings, enabled: false };
    if (persist) saveSettings();
    syncFocusSoundUi();
    return false;
  }
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = createNoiseBuffer(ctx, settings.type); source.loop = true;
  let node = source;
  if (settings.type === 'brown') node = addFocusFilter(ctx, node, 'lowpass', 1400, .6);
  else if (settings.type === 'rain') { node = addFocusFilter(ctx, node, 'highpass', 850, .55); node = addFocusFilter(ctx, node, 'lowpass', 5200, .8); }
  else if (settings.type === 'waves') node = addFocusFilter(ctx, node, 'lowpass', 720, .7);
  else if (settings.type === 'cafe') { node = addFocusFilter(ctx, node, 'bandpass', 900, .65); node = addFocusFilter(ctx, node, 'lowpass', 2600, .75); }
  else if (settings.type === 'pink') node = addFocusFilter(ctx, node, 'lowpass', 9000, .45);
  const baseGain = getFocusSoundGainValue(settings.volume);
  gain.gain.setValueAtTime(baseGain, ctx.currentTime);
  if (settings.type === 'waves' || settings.type === 'rain' || settings.type === 'cafe') {
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = settings.type === 'waves' ? .08 : settings.type === 'rain' ? .42 : .18;
    lfoGain.gain.value = baseGain * (settings.type === 'waves' ? .55 : .18);
    gain.gain.setValueAtTime(Math.max(.0001, baseGain * (settings.type === 'waves' ? .72 : .9)), ctx.currentTime);
    lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start(); focusAudio.nodes.push(lfo, lfoGain);
  }
  node.connect(gain); gain.connect(ctx.destination); source.start();
  Object.assign(focusAudio, { source, gain, playing: true, type: settings.type });
  state.settings.focusSound = settings;
  if (persist) saveSettings();
  syncFocusSoundUi();
  return true;
}

function stopFocusSound(persist = true) {
  try { focusAudio.source?.stop(); } catch {}
  [focusAudio.source, focusAudio.gain, ...focusAudio.nodes].forEach(node => { try { node?.disconnect?.(); } catch {} });
  Object.assign(focusAudio, { source: null, gain: null, nodes: [], playing: false, type: null });
  if (persist) { state.settings.focusSound = { ...normalizeFocusSoundSettings(), enabled: false }; saveSettings(); syncFocusSoundUi(); }
}

function setFocusSoundVolume(volume) {
  const settings = normalizeFocusSoundSettings({ ...state.settings.focusSound, volume });
  state.settings.focusSound = settings; saveSettings();
  if (focusAudio.gain) {
    const now = focusAudio.ctx.currentTime;
    focusAudio.gain.gain.cancelScheduledValues(now);
    focusAudio.gain.gain.setTargetAtTime(getFocusSoundGainValue(settings.volume), now, .08);
  }
  syncFocusSoundUi();
}

function setFocusSoundType(type) {
  if (!FOCUS_SOUND_TYPES[type]) return;
  const wasPlaying = focusAudio.playing || normalizeFocusSoundSettings().enabled;
  state.settings.focusSound = normalizeFocusSoundSettings({ ...state.settings.focusSound, type, enabled: wasPlaying });
  saveSettings(); syncFocusSoundUi();
  if (wasPlaying) startFocusSound(false);
}

async function toggleFocusSound(enabled) {
  if (enabled) await startFocusSound(true);
  else stopFocusSound(true);
}

function maybeResumeFocusSound() {
  const settings = normalizeFocusSoundSettings();
  if (settings.enabled && !focusAudio.playing) startFocusSound(false);
}

function syncFocusSoundUi() {
  const settings = normalizeFocusSoundSettings(); state.settings.focusSound = settings;
  const toggle = $('#focusSoundToggle'), volume = $('#focusSoundVolume'), output = $('#focusSoundOutput'), status = $('#focusSoundStatus');
  if (toggle) toggle.checked = settings.enabled;
  if (volume) volume.value = settings.volume;
  if (output) output.textContent = settings.volume + '%';
  if (status) status.textContent = focusAudio.playing ? FOCUS_SOUND_TYPES[settings.type].label + '播放中' : (settings.enabled ? '点击页面后恢复播放' : '已关闭');
  $$('[data-focus-sound]').forEach(button => {
    const selected = button.dataset.focusSound === settings.type;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
}

async function playBeep(isTest = false) {
  try {
    const ctx = await ensureAudioContext(isTest);
    if (!ctx || ctx.state !== 'running') return false;
    [0, .2, .4].forEach(delay => {
      const o = ctx.createOscillator(), g = ctx.createGain(), start = ctx.currentTime + delay;
      o.frequency.value = 760;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.18, start);
      g.gain.exponentialRampToValueAtTime(.001, start + .12);
      o.start(start); o.stop(start + .13);
    });
    return true;
  } catch {
    if (isTest) showToast('提示音播放失败，请检查浏览器声音权限', 'warning');
    return false;
  }
}

async function testSound() {
  await unlockAudio(false);
  const played = await playBeep(true);
  if (played) showToast('提示音正常。如果 iOS 仍听不到，请检查静音模式和媒体音量');
}
function stopInterval() { clearInterval(state.interval); state.interval = null; }
function showToast(message, type = '') { const el=$('#toast'); el.textContent=message;el.classList.toggle('warning-toast',type==='warning');el.classList.remove('hidden');clearTimeout(el._timer);el._timer=setTimeout(()=>{el.classList.add('hidden');el.classList.remove('warning-toast')},type==='warning'?5200:2200); }
function hideToast() { const el=$('#toast'); clearTimeout(el._timer); el.classList.add('hidden'); el.classList.remove('warning-toast'); }
function resetFinishDialog() {
  $('#scoreInputWrap').classList.add('hidden'); $('#questionInputWrap').classList.add('hidden'); $('#correctInputWrap').classList.add('hidden'); $('#quantityChoiceWrap').classList.add('hidden');
  $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').textContent = '保存记录';
}
function showCompletion(title,message){ resetFinishDialog(); $('#dialogTitle').textContent=title;$('#dialogMessage').textContent=message;$('#cancelFinishBtn').classList.add('hidden');$('#confirmFinishBtn').textContent='知道了';$('#finishDialog').showModal(); }
function openDrawer(drawer){ closeDrawers();drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');$('#backdrop').classList.remove('hidden'); }
function closeDrawers(){ $$('.drawer').forEach(d=>{d.classList.remove('open');d.setAttribute('aria-hidden','true')});$('#backdrop').classList.add('hidden'); }

let pipWindow = null;
let pipStream = null;
let pipFrame = null;
const pipVideo = $('#pipVideo');
const pipCanvas = $('#pipCanvas');
const pipContext = pipCanvas.getContext('2d');
const pipOutputCanvas = $('#pipOutputCanvas');
const pipGl = pipOutputCanvas.getContext('webgl2', { alpha: false, antialias: false }) || pipOutputCanvas.getContext('webgl', { alpha: false, antialias: false });
let pipGlProgram = null;
let pipGlTexture = null;
let pipCaptionTrack = null;
let pipCaptionCue = null;
let mobilePipSyncTimer = null;

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function drawVideoPip() {
  const isOvertime = state.mode !== 'single' && state.autoFinished;
  const seconds = state.mode === 'single' ? state.elapsed : (isOvertime ? Math.max(0, state.elapsed - state.duration) : state.remaining);
  pipContext.fillStyle = '#18201b'; pipContext.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
  pipContext.textAlign = 'center'; pipContext.fillStyle = '#a9b8ae'; pipContext.font = '600 30px sans-serif';
  pipContext.fillText(state.preset.name, pipCanvas.width / 2, 82);
  pipContext.fillStyle = isOvertime ? '#ef756e' : '#f2f5f2';
  pipContext.font = '700 92px monospace'; pipContext.fillText(formatClock(seconds), pipCanvas.width / 2, 215);
  pipContext.fillStyle = isOvertime ? '#ef756e' : '#73ae92'; pipContext.font = '24px sans-serif';
  pipContext.fillText({ idle:'准备开始', running:isOvertime ? '已超时' : '计时中', paused:isOvertime ? '超时暂停' : '已暂停', finished:'本轮结束' }[state.status], pipCanvas.width / 2, 292);
  renderWebGlPip();
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return shader;
}

function initWebGlPip() {
  if (!pipGl || pipGlProgram) return;
  const vertex = createShader(pipGl, pipGl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 t;varying vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=t;}');
  const fragment = createShader(pipGl, pipGl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D image;varying vec2 v;void main(){gl_FragColor=texture2D(image,v);}');
  pipGlProgram = pipGl.createProgram(); pipGl.attachShader(pipGlProgram, vertex); pipGl.attachShader(pipGlProgram, fragment); pipGl.linkProgram(pipGlProgram); pipGl.useProgram(pipGlProgram);
  const buffer = pipGl.createBuffer(); pipGl.bindBuffer(pipGl.ARRAY_BUFFER, buffer);
  pipGl.bufferData(pipGl.ARRAY_BUFFER, new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, -1,1,0,0, 1,-1,1,1, 1,1,1,0]), pipGl.STATIC_DRAW);
  const position = pipGl.getAttribLocation(pipGlProgram, 'p'), texture = pipGl.getAttribLocation(pipGlProgram, 't');
  pipGl.enableVertexAttribArray(position); pipGl.vertexAttribPointer(position, 2, pipGl.FLOAT, false, 16, 0);
  pipGl.enableVertexAttribArray(texture); pipGl.vertexAttribPointer(texture, 2, pipGl.FLOAT, false, 16, 8);
  pipGlTexture = pipGl.createTexture(); pipGl.bindTexture(pipGl.TEXTURE_2D, pipGlTexture);
  pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_MIN_FILTER, pipGl.LINEAR); pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_MAG_FILTER, pipGl.LINEAR);
  pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_WRAP_S, pipGl.CLAMP_TO_EDGE); pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_WRAP_T, pipGl.CLAMP_TO_EDGE);
}

function renderWebGlPip() {
  if (!pipGl) return;
  initWebGlPip(); pipGl.viewport(0, 0, pipOutputCanvas.width, pipOutputCanvas.height);
  pipGl.bindTexture(pipGl.TEXTURE_2D, pipGlTexture); pipGl.texImage2D(pipGl.TEXTURE_2D, 0, pipGl.RGBA, pipGl.RGBA, pipGl.UNSIGNED_BYTE, pipCanvas);
  pipGl.drawArrays(pipGl.TRIANGLES, 0, 6); pipGl.flush();
}

function keepPipFramesAlive() {
  if (pipFrame) return;
  const refresh = () => { drawVideoPip(); pipFrame = requestAnimationFrame(refresh); };
  pipFrame = requestAnimationFrame(refresh);
}

async function ensureVideoPipSource() {
  if (isAppleMobile()) {
    await syncMobilePipSource(true);
    ensureNativeCaption();
  } else {
    drawVideoPip();
    if (!pipStream) {
      const sourceCanvas = pipGl ? pipOutputCanvas : pipCanvas;
      pipStream = sourceCanvas.captureStream(2);
      pipVideo.srcObject = pipStream;
    }
    keepPipFramesAlive(); await pipVideo.play();
  }
}

async function syncMobilePipSource(force = false) {
  if (!isAppleMobile()) return;
  const source = (state.mode === 'single' || state.autoFinished) ? 'pip-stopwatch.mp4' : 'pip-countdown.mp4';
  if (!pipVideo.src.endsWith(source)) {
    pipVideo.srcObject = null; pipVideo.src = source; pipVideo.load();
    await new Promise((resolve, reject) => {
      if (pipVideo.readyState >= 1) { resolve(); return; }
      pipVideo.addEventListener('loadedmetadata', resolve, { once: true });
      pipVideo.addEventListener('error', reject, { once: true });
    });
  }
  syncNativeVideoTime(force); updateNativeCaption();
}

function ensureNativeCaption() {
  if (!pipCaptionTrack) {
    pipCaptionTrack = pipVideo.addTextTrack('captions', '实时计时', 'zh-CN');
    pipCaptionTrack.mode = 'showing';
  }
  updateNativeCaption();
}

function updateNativeCaption() {
  if (!pipCaptionTrack) return;
  if (pipCaptionCue) pipCaptionTrack.removeCue(pipCaptionCue);
  const isOvertime = state.mode !== 'single' && state.autoFinished;
  const status = { idle:'准备开始', running:isOvertime ? '已超时' : '计时中', paused:isOvertime ? '超时暂停' : '已暂停', finished:'本轮结束' }[state.status];
  const Cue = window.VTTCue || window.TextTrackCue;
  if (!Cue) return;
  pipCaptionCue = new Cue(0, Number.MAX_SAFE_INTEGER, `${state.preset.name}  ·  ${status}`);
  pipCaptionCue.align = 'center'; pipCaptionCue.line = 88; pipCaptionCue.size = 70;
  pipCaptionTrack.addCue(pipCaptionCue);
}

function getMobilePipTargetTime() {
  const displaySeconds = state.mode === 'single' ? state.elapsed : (state.autoFinished ? Math.max(0, state.elapsed - state.duration) : state.remaining);
  const rounded = Math.max(0, Math.round(displaySeconds));
  return (state.mode === 'single' || state.autoFinished) ? Math.min(rounded, 10800) : Math.max(0, 10800 - Math.min(rounded, 10800));
}

function syncNativeVideoTime(force = false) {
  if (!isAppleMobile() || !pipVideo.src || pipVideo.readyState < 1) return;
  const target = getMobilePipTargetTime();
  const threshold = state.status === 'running' ? 0.25 : 0.05;
  if (force || Math.abs(pipVideo.currentTime - target) > threshold) pipVideo.currentTime = target;
  if (state.status === 'running') pipVideo.play().catch(() => {});
  else pipVideo.pause();
}

function startMobilePipSyncLoop() {
  if (mobilePipSyncTimer || !isAppleMobile()) return;
  mobilePipSyncTimer = setInterval(() => syncNativeVideoTime(false), 250);
}

function stopMobilePipSyncLoop() {
  clearInterval(mobilePipSyncTimer); mobilePipSyncTimer = null;
}

function supportsSafariPip() {
  return typeof pipVideo.webkitSetPresentationMode === 'function' &&
    (!pipVideo.webkitSupportsPresentationMode || pipVideo.webkitSupportsPresentationMode('picture-in-picture'));
}

async function toggleVideoPip() {
  await ensureVideoPipSource();
  if (supportsSafariPip()) {
    const leaving = pipVideo.webkitPresentationMode === 'picture-in-picture';
    pipVideo.webkitSetPresentationMode(leaving ? 'inline' : 'picture-in-picture');
    if (leaving) stopMobilePipSyncLoop();
    else { syncNativeVideoTime(true); startMobilePipSyncLoop(); }
    if (!leaving && isAppleMobile()) showToast('已开启画中画，可返回桌面或切换应用');
    return;
  }
  if (document.pictureInPictureEnabled && pipVideo.requestPictureInPicture) {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await pipVideo.requestPictureInPicture();
    return;
  }
  throw new Error('Picture-in-Picture unavailable');
}

async function togglePip() {
  try {
    if (pipWindow) { pipWindow.close(); return; }
    if ('documentPictureInPicture' in window && !isAppleMobile()) {
      pipWindow = await documentPictureInPicture.requestWindow({ width: 340, height: 180 });
      const style = pipWindow.document.createElement('style'); style.textContent='body{margin:0;background:#18201b;color:#f2f5f2;display:grid;place-items:center;height:100vh;font-family:Segoe UI,sans-serif}.wrap{text-align:center}.time{font:700 48px Consolas,monospace}.name{color:#a9b8ae;margin-bottom:8px}.status{color:#73ae92;font-size:12px;margin-top:8px}'; pipWindow.document.head.append(style);
      pipWindow.document.body.innerHTML='<div class="wrap"><div class="name"></div><div class="time"></div><div class="status"></div></div>'; pipWindow.addEventListener('pagehide',()=>pipWindow=null); updatePip(); return;
    }
    await toggleVideoPip();
  } catch {
    showToast(isAppleMobile() ? '请在系统设置中开启“自动画中画”，并使用 Safari 打开' : '当前浏览器不支持悬浮计时');
  }
}
window.state = state;
window.resetTimer = resetTimer;
window.buildExportData = buildExportData;
window.buildRecordsCsv = buildRecordsCsv;
window.normalizeImportedData = normalizeImportedData;
window.syncNativeVideoTime = syncNativeVideoTime;
window.getMobilePipTargetTime = getMobilePipTargetTime;

function updatePip(){
  drawVideoPip();
  syncNativeVideoTime();
  updateNativeCaption();
  if(!pipWindow)return;
  pipWindow.document.querySelector('.name').textContent=state.preset.name;pipWindow.document.querySelector('.time').textContent=formatClock(state.mode==='single'?state.elapsed:state.remaining);pipWindow.document.querySelector('.status').textContent={idle:'准备开始',running:'计时中',paused:'已暂停',finished:'本轮结束'}[state.status];
}

$$('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('#startBtn').addEventListener('click', startOrPause); $('#resetBtn').addEventListener('click', () => resetTimer(true)); $('#finishBtn').addEventListener('click', requestFinish);
$('#lapBtn').addEventListener('click', recordLap); $('#undoLapBtn').addEventListener('click', undoLap); $('#timerDisplay').addEventListener('click', recordLap);
$('#timerDisplay').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); recordLap(); } });
document.addEventListener('keydown', handleGlobalShortcut);
document.addEventListener('visibilitychange', () => {
  if (state.status === 'running') tick();
});
$('#confirmFinishBtn').addEventListener('click', confirmFinish);
$('#cancelFinishBtn').addEventListener('click', () => { state.pendingTimed = null; $('#finishDialog').close(); resetFinishDialog(); render(); syncNativeVideoTime(true); });
$$('#quantityChoiceWrap [data-quantity]').forEach(button => button.addEventListener('click', () => saveQuantitySession(Number(button.dataset.quantity))));
$('#cancelSingleModuleBtn').addEventListener('click', cancelSpeedSession);
$('#nextSpeedStepBtn').addEventListener('click', showSpeedNextStep);
$('#singleModuleDialog').addEventListener('cancel', event => { event.preventDefault(); cancelSpeedSession(); });
$$('#difficultyChoices [data-difficulty]').forEach(button => button.addEventListener('click', () => {
  const willSelect = button.getAttribute('aria-pressed') !== 'true';
  $$('#difficultyChoices [data-difficulty]').forEach(item => { item.classList.remove('selected'); item.setAttribute('aria-pressed', 'false'); });
  if (willSelect) { button.classList.add('selected'); button.setAttribute('aria-pressed', 'true'); }
}));
$$('#editRecordDifficultyChoices [data-difficulty]').forEach(button => button.addEventListener('click', () => {
  const willSelect = button.getAttribute('aria-pressed') !== 'true';
  setDifficultyChoice('editRecordDifficultyChoices', willSelect ? button.dataset.difficulty : null);
}));
$('#skipTrainingMetaBtn').addEventListener('click', () => finishTrainingMeta(true)); $('#confirmTrainingMetaBtn').addEventListener('click', () => finishTrainingMeta(false));
$('#recordEditForm').addEventListener('submit', event => { event.preventDefault(); saveRecordEditor(); });
$('#cancelRecordEditBtn').addEventListener('click', closeRecordEditor);
$('#recordEditDialog').addEventListener('cancel', event => { event.preventDefault(); closeRecordEditor(); });
$('#skipMockModuleBtn').addEventListener('click', () => finishMockModuleReview(true)); $('#saveMockModuleBtn').addEventListener('click', () => finishMockModuleReview(false));
$('#mockModuleDialog').addEventListener('cancel', event => { event.preventDefault(); finishMockModuleReview(true); });
$('#closeMockReportBtn').addEventListener('click', () => $('#mockReportDialog').close());
$('#editMockReportBtn').addEventListener('click', () => editMockReport($('#editMockReportBtn').dataset.mockReportId));
$('#openReportLapReviewBtn').addEventListener('click', () => openReportLapReview($('#openReportLapReviewBtn').dataset.lapId));
$('#trainingMetaDialog').addEventListener('cancel', event => { event.preventDefault(); finishTrainingMeta(true); });
$('#lapDetailList').addEventListener('click', updateLapReviewFromClick); $('#lapDetailList').addEventListener('input', updateLapReviewNote);
$('#saveLapReviewBtn').addEventListener('click', saveLapReviews); $('#closeLapDetailBtn').addEventListener('click', closeLapDetail);
$('#lapDetailDialog').addEventListener('cancel', event => { event.preventDefault(); closeLapDetail(); });
$('#statsBtn').addEventListener('click', openStatsDrawer);$('#settingsBtn').addEventListener('click',()=>openSettingsDrawer());$('#backdrop').addEventListener('click',closeDrawers);$$('.close-drawer').forEach(b=>b.addEventListener('click',closeDrawers));
$('#clearAllBtn').addEventListener('click',()=>{if(state.records.length&&confirm('确定清空全部训练记录吗？此操作无法撤销。')){state.records=[];saveRecords();renderStats();}});
$('#historyFilter').addEventListener('change', renderStats);
$('#historyList').addEventListener('click', openRecordFromHistoryEvent);
$('#historyList').addEventListener('keydown', openRecordFromHistoryKey);
$$('[data-analytics-days]').forEach(button => button.addEventListener('click', () => { state.analyticsDays = Number(button.dataset.analyticsDays); renderStats(); }));
$$('[data-trend-metric]').forEach(button => button.addEventListener('click', () => { state.trendMetric = button.dataset.trendMetric; renderStats(); }));
$$('[data-trend-visual]').forEach(button => button.addEventListener('click', () => { state.trendVisual = button.dataset.trendVisual; renderStats(); }));
$$('[data-stats-view]').forEach(button => button.addEventListener('click', () => setStatsView(button.dataset.statsView)));
$$('[data-settings-view]').forEach(button => button.addEventListener('click', () => setSettingsView(button.dataset.settingsView)));
$('#soundToggle').addEventListener('change',e=>{state.settings.sound=e.target.checked;if(e.target.checked)unlockAudio(false);saveSettings()});$('#testSoundBtn').addEventListener('click',testSound);$('#focusSoundToggle').addEventListener('change',e=>toggleFocusSound(e.target.checked));$$('[data-focus-sound]').forEach(button=>button.addEventListener('click',()=>setFocusSoundType(button.dataset.focusSound)));$('#focusSoundVolume').addEventListener('input',e=>setFocusSoundVolume(+e.target.value));$('#pacingToggle').addEventListener('change',e=>{state.settings.pacing=e.target.checked;state.pacingNotified=[];saveSettings();render()});$('#shortcutsToggle').addEventListener('change',e=>{state.settings.shortcuts=e.target.checked;applySettings();saveSettings();showToast(e.target.checked?'全局快捷键已开启':'全局快捷键已关闭')});$('#themeToggle').addEventListener('change',e=>{state.settings.dark=e.target.checked;applySettings();saveSettings()});
$('#fontSizeRange').addEventListener('input',e=>{state.settings.fontSize=+e.target.value;applySettings();saveSettings()});$('#warningRange').addEventListener('input',e=>{state.settings.warning=+e.target.value;applySettings();saveSettings();render()});
$('#examCountdownOpenBtn').addEventListener('click', openExamCountdownSettings); $('#examCheckinBtn').addEventListener('click', checkInExamCountdown);
$('#saveExamCountdownBtn').addEventListener('click', saveExamCountdownSettings); $('#settingsExamCheckinBtn').addEventListener('click', checkInExamCountdown);
$('#saveSectionTimesBtn').addEventListener('click', saveSectionTimes);
$('#sectionTimeGrid').addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' || event.button !== 0 || event.target.closest('input,button,a')) return;
  const card = event.target.closest('[data-section-card]'); if (card) beginSectionSort(card, event.clientX, event.clientY, 'pointer', event.pointerId);
});
document.addEventListener('pointermove', event => { if (sectionSort.inputType === 'pointer' && event.pointerId === sectionSort.pointerId) moveSectionSort(event.clientX, event.clientY, event); });
document.addEventListener('pointerup', event => { if (sectionSort.inputType === 'pointer' && event.pointerId === sectionSort.pointerId) finishSectionSort(false); });
document.addEventListener('pointercancel', event => { if (sectionSort.inputType === 'pointer' && event.pointerId === sectionSort.pointerId) finishSectionSort(true); });
$('#sectionTimeGrid').addEventListener('touchstart', event => {
  if (event.touches.length !== 1 || event.target.closest('input,button,a')) return;
  const card = event.target.closest('[data-section-card]'), touch = event.touches[0]; if (card) beginSectionSort(card, touch.clientX, touch.clientY, 'touch', touch.identifier);
}, { passive: true });
document.addEventListener('touchmove', event => {
  if (sectionSort.inputType !== 'touch') return;
  const touch = [...event.touches].find(item => item.identifier === sectionSort.touchId); if (touch) moveSectionSort(touch.clientX, touch.clientY, event);
}, { passive: false });
document.addEventListener('touchend', event => { if (sectionSort.inputType === 'touch' && [...event.changedTouches].some(item => item.identifier === sectionSort.touchId)) finishSectionSort(false); });
document.addEventListener('touchcancel', event => { if (sectionSort.inputType === 'touch' && [...event.changedTouches].some(item => item.identifier === sectionSort.touchId)) finishSectionSort(true); });
document.addEventListener('contextmenu', event => { if (sectionSort.card || event.target.closest('[data-section-card]')) event.preventDefault(); });
$('#sectionTimeGrid').addEventListener('dragstart', event => event.preventDefault());
$('#exportDataBtn').addEventListener('click', exportData); $('#exportCsvBtn').addEventListener('click', exportRecordsCsv); $('#importDataBtn').addEventListener('click', () => $('#importDataInput').click()); $('#importDataInput').addEventListener('change', e => { importDataFile(e.target.files[0]); e.target.value = ''; });
$('#cancelRestoreBtn').addEventListener('click', cancelRestoreImport); $('#confirmMergeRestoreBtn').addEventListener('click', () => confirmRestoreImport('merge')); $('#confirmRestoreBtn').addEventListener('click', () => confirmRestoreImport('replace'));
$('#pipBtn').addEventListener('click',togglePip);
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(error => console.warn('Service Worker 注册失败', error)));
}
document.addEventListener('pointerdown', maybeResumeFocusSound, { passive: true });
document.addEventListener('keydown', maybeResumeFocusSound);
window.addEventListener('beforeunload', () => { stopInterval(); stopMobilePipSyncLoop(); stopFocusSound(false); }); applyCustomDurations(); applySettings(); renderSectionTimeSettings(); renderPresets(); renderStats(); renderDataManagementSummary(); render();
