import { showToast } from './ui.js';

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

function $(selector) { return document.querySelector(selector); }
function $$(selector) { return [...document.querySelectorAll(selector)]; }
const STORAGE_RECORDS = 'examTimer.records.v1';
const STORAGE_SETTINGS = 'examTimer.settings.v1';
const STORAGE_SESSION = 'examTimer.activeSession.v1';
const APP_VERSION = 'v2.23.0';
const TRACKING_CATEGORIES = [...PRESETS.mock, ...PRESETS.section].map(({ name }) => name);
const SECTION_QUESTION_COUNTS = { '资料分析': 20, '言语理解': 30, '判断推理': 35, '政治理论': 20, '常识判断': 15 };
const MOCK_PACING_QUESTION_COUNTS = { ...SECTION_QUESTION_COUNTS, '数量关系': 15 };
const MOCK_MODULE_NAMES = PRESETS.section.map(preset => preset.name);
const TRAINING_DIFFICULTIES = ['简单', '正常', '较难'];
const SPEED_SCORE_TYPES = new Set(PRESETS.mock.map(preset => preset.name));
const LAP_REVIEW_STATUSES = ['correct', 'wrong', 'skipped'];
const LAP_ERROR_REASONS = ['知识盲区', '理解偏差', '计算失误', '方法不优', '时间不足', '审题不清', '选项纠结', '陷阱失误', '蒙错'];
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
  pendingSpeed: null, pendingTimed: null, pendingMeta: null, pendingMockModuleDraft: null, reviewingRecordId: null, editingRecordId: null, lapReviewDraft: [], analyticsDays: 7, trendMetric: 'duration', trendVisual: 'bar', statsView: 'overview', settingsView: 'general', records: normalizeRecords(loadJSON(STORAGE_RECORDS, [])),
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
    const reason = status === 'wrong' ? (LAP_ERROR_REASONS.includes(review.reason) ? review.reason : normalizeText(review.reason, 16) || null) : null;
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

function normalizeRecordId(value, record) {
  const candidate = String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 128);
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate)) return candidate;
  const signature = [record.mode, record.module, record.startedAt, record.endedAt, record.duration, record.questions, record.correct, record.score, record.papers].join('|');
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(36)}`;
}

function normalizeTimestamp(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeDuration(value, { nullable = false } = {}) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60) return nullable ? null : 0;
  return Math.round(duration * 1000) / 1000;
}

function normalizeRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.filter(record => record && typeof record === 'object' && !Array.isArray(record)).map(record => {
    const duration = normalizeDuration(record.duration);
    const endedAt = normalizeTimestamp(record.endedAt);
    if (!duration || !endedAt) return null;
    const mode = ['mock', 'section', 'single'].includes(record.mode) ? record.mode : 'single';
    const module = normalizeText(record.module, 80) || '未分类';
    const startedAt = normalizeTimestamp(record.startedAt) || new Date(new Date(endedAt).getTime() - duration * 1000).toISOString();
    const updatedAt = normalizeTimestamp(record.updatedAt);
    const questions = toPositiveInt(record.questions);
    const correct = toNonNegativeInt(record.correct);
    const score = toScore(record.score);
    const papers = toPositiveInt(record.papers);
    const laps = normalizeLaps(record.laps);
    const lapReviews = normalizeLapReviews(record.lapReviews ?? record.reviews, laps.length);
    const moduleResults = normalizeModuleResults(record.moduleResults);
    const nestedMeta = record.meta && typeof record.meta === 'object' && !Array.isArray(record.meta) ? record.meta : {};
    const meta = normalizeTrainingMeta({ ...nestedMeta, source: record.source ?? nestedMeta.source, difficulty: record.difficulty ?? nestedMeta.difficulty, note: record.note ?? nestedMeta.note });
    const normalizedRecord = {
      id: null,
      mode,
      module,
      duration,
      planned: normalizeDuration(record.planned, { nullable: true }),
      startedAt,
      endedAt,
      questions,
      correct: questions && correct !== null ? Math.min(correct, questions) : null,
      score,
      papers,
      laps,
      lapReviews,
      moduleResults,
      ...meta
    };
    normalizedRecord.id = normalizeRecordId(record.id, normalizedRecord);
    if (updatedAt) normalizedRecord.updatedAt = updatedAt;
    return normalizedRecord;
  }).filter(Boolean);
}

function saveToStorage(key, value, label) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`${label}保存失败`, error);
    showToast(`${label}保存失败，请先导出备份并清理浏览器存储空间`);
    return false;
  }
}
function saveSettings() { return saveToStorage(STORAGE_SETTINGS, state.settings, '设置'); }
function saveRecords() { return saveToStorage(STORAGE_RECORDS, state.records, '训练记录'); }
let lastSessionPersistAt = 0;
function clearActiveSession() {
  try { localStorage.removeItem(STORAGE_SESSION); } catch {}
  lastSessionPersistAt = 0;
}
function persistActiveSession(force = false) {
  if (state.status === 'idle' || state.elapsed < .5) { clearActiveSession(); return true; }
  const now = Date.now();
  if (!force && now - lastSessionPersistAt < 4000) return true;
  const snapshot = {
    version: 1, savedAt: new Date(now).toISOString(), mode: state.mode, presetName: state.preset.name,
    duration: state.duration, remaining: state.remaining, elapsed: state.elapsed, status: state.status,
    startedAt: state.startedAt, autoFinished: state.autoFinished, laps: normalizeLaps(state.laps),
    lastLapElapsed: state.lastLapElapsed, pacingNotified: [...state.pacingNotified]
  };
  lastSessionPersistAt = now;
  const saved = saveToStorage(STORAGE_SESSION, snapshot, '当前训练');
  return saved;
}
function restoreActiveSession() {
  const snapshot = loadJSON(STORAGE_SESSION, null);
  if (!snapshot || typeof snapshot !== 'object' || !['mock', 'section', 'single'].includes(snapshot.mode)) return false;
  const savedAt = new Date(snapshot.savedAt).getTime(), age = Date.now() - savedAt;
  if (!Number.isFinite(savedAt) || age < 0 || age > 24 * 60 * 60 * 1000) { clearActiveSession(); return false; }
  const preset = PRESETS[snapshot.mode].find(item => item.name === snapshot.presetName);
  const elapsed = Number(snapshot.elapsed), duration = Number(snapshot.duration), remaining = Number(snapshot.remaining);
  if (!preset || !Number.isFinite(elapsed) || elapsed < .5 || !Number.isFinite(duration) || duration < 0) { clearActiveSession(); return false; }
  const inactiveSeconds = snapshot.status === 'running' ? Math.min(age / 1000, 6 * 60 * 60) : 0;
  state.mode = snapshot.mode; state.preset = preset; state.duration = duration;
  state.elapsed = elapsed + inactiveSeconds;
  state.remaining = snapshot.mode === 'single' ? 0 : Math.max(0, (Number.isFinite(remaining) ? remaining : duration - elapsed) - inactiveSeconds);
  state.startedAt = normalizeTimestamp(snapshot.startedAt) || new Date(Date.now() - state.elapsed * 1000).toISOString();
  state.status = 'paused'; state.tickBase = null; state.interval = null;
  state.autoFinished = snapshot.mode !== 'single' && (Boolean(snapshot.autoFinished) || state.remaining <= 0);
  state.laps = normalizeLaps(snapshot.laps); state.lastLapElapsed = Math.min(state.elapsed, Number(snapshot.lastLapElapsed) || state.laps.reduce((sum, value) => sum + value, 0));
  state.pacingNotified = Array.isArray(snapshot.pacingNotified) ? snapshot.pacingNotified.map(Number).filter(Number.isFinite) : [];
  $$('.mode-tab').forEach(tab => { const active = tab.dataset.mode === state.mode; tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active)); });
  persistActiveSession(true);
  return true;
}

export { $, $$, ANALYTICS_COLORS, APP_VERSION, DEFAULT_SECTION_ORDER, FOCUS_SOUND_TYPES, LAP_ERROR_REASONS, MOCK_MODULE_NAMES, MOCK_PACING_QUESTION_COUNTS, PRESETS, SECTION_QUESTION_COUNTS, SPEED_SCORE_TYPES, STORAGE_RECORDS, STORAGE_SETTINGS, TRACKING_CATEGORIES, clearActiveSession, escapeAttribute, escapeHTML, normalizeLapReviews, normalizeLaps, normalizeModuleResults, normalizeRecords, normalizeText, normalizeTrainingMeta, persistActiveSession, restoreActiveSession, saveRecords, saveSettings, state, toNonNegativeInt, toPositiveInt, toScore };
