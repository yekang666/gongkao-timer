import { getPeriodRecords } from './analytics.js';
import { $, $$, MOCK_PACING_QUESTION_COUNTS, escapeHTML, normalizeModuleResults, saveSettings, state, toNonNegativeInt, toPositiveInt, toScore } from './core.js';
import { formatAccuracy } from './format.js';
import { getOrderedSectionPresets, getSectionDurations } from './sections.js';
import { showToast } from './ui.js';

// 国考行测参考分值（官方未公布，采用民间流传的经典参考表，按 2024 改革后题量结构适配）。
// 副省级 135 题恰好合计 100 分；地市级数量关系少 5 题，按比例折算回 100 分。
const PREDICT_GUESS_RATE = 0.25; // 全卷单选，未答完部分按四选一蒙对率估算
const PREDICT_WEIGHTS = { '资料分析': 1, '言语理解': 0.8, '判断推理': 23.5 / 35, '数量关系': 1, '政治理论': 0.5, '常识判断': 0.5 };
const PREDICT_LEVELS = {
  deputy: { label: '副省级', counts: { ...MOCK_PACING_QUESTION_COUNTS } },
  city: { label: '地市级', counts: { ...MOCK_PACING_QUESTION_COUNTS, '数量关系': 10 } }
};
const PREDICT_WINDOWS = [
  { days: 30, label: '最近 30 天' },
  { days: 90, label: '最近 90 天' },
  { days: 3650, label: '全部记录' }
];
const PREDICT_MIN_SAMPLE = 40; // 窗口内正确率样本题量低于该值时自动放宽时间窗口

function getPredictLevel() { return state.settings.predictLevel === 'city' ? 'city' : 'deputy'; }

function getLevelPlan(levelKey = getPredictLevel()) {
  const level = PREDICT_LEVELS[levelKey];
  const rawTotal = Object.entries(level.counts).reduce((sum, [name, count]) => sum + count * PREDICT_WEIGHTS[name], 0);
  const scale = 100 / rawTotal;
  const modules = Object.fromEntries(Object.entries(level.counts).map(([name, count]) => [name, { questions: count, weight: PREDICT_WEIGHTS[name] * scale, full: count * PREDICT_WEIGHTS[name] * scale }]));
  return { key: levelKey, label: level.label, modules, totalQuestions: Object.values(level.counts).reduce((sum, count) => sum + count, 0), scaled: Math.abs(scale - 1) > 0.001 };
}

// 汇总某模块在一批记录里的正确率与速度样本（专项/自由测速直录 + 模考模块复盘，模考样本权重更高，近期样本权重更高）
function collectModuleSamples(records, moduleName, now) {
  const dayMs = 24 * 60 * 60 * 1000;
  const samples = [];
  for (const record of records) {
    const age = Math.max(0, (now - new Date(record.endedAt).getTime()) / dayMs);
    const recency = Math.exp(-age / 21);
    if (record.module === moduleName && toPositiveInt(record.questions)) {
      samples.push({ questions: toPositiveInt(record.questions), correct: toNonNegativeInt(record.correct), duration: Number.isFinite(record.duration) && record.duration > 0 ? record.duration : null, weight: recency });
    }
    if (record.module === '行测模考') {
      for (const result of normalizeModuleResults(record.moduleResults)) {
        if (result.module !== moduleName || (result.correct === null && result.duration === null)) continue;
        samples.push({ questions: result.questions, correct: result.correct, duration: result.duration, weight: recency * 1.3 });
      }
    }
  }
  const accuracyRows = samples.filter(sample => sample.correct !== null);
  const timedRows = samples.filter(sample => sample.duration !== null && sample.questions);
  const accuracyWeight = accuracyRows.reduce((sum, row) => sum + row.weight * row.questions, 0);
  const paceWeight = timedRows.reduce((sum, row) => sum + row.weight * row.questions, 0);
  return {
    sampleQuestions: accuracyRows.reduce((sum, row) => sum + row.questions, 0),
    accuracy: accuracyWeight ? accuracyRows.reduce((sum, row) => sum + row.weight * row.correct, 0) / accuracyWeight : null,
    pace: paceWeight ? timedRows.reduce((sum, row) => sum + row.weight * row.duration, 0) / paceWeight : null
  };
}

function getSampleGrade(questions) {
  if (!questions) return { key: 'none', label: '暂无数据' };
  if (questions >= 60) return { key: 'high', label: '数据充足' };
  if (questions >= 20) return { key: 'mid', label: '数据一般' };
  return { key: 'low', label: '数据偏少' };
}

// 核心模型：预计得分 = Σ 模块题量 ×（答完部分 × 个人正确率 + 未答完部分 × 蒙对率）× 每题参考分值
export function buildPrediction(records, plan, now = Date.now()) {
  const durations = getSectionDurations();
  const totalSectionSeconds = Object.values(durations).reduce((sum, seconds) => sum + seconds, 0);
  const moduleNames = getOrderedSectionPresets().map(preset => preset.name);
  const pooled = { correctWeight: 0, questionWeight: 0 };
  const stats = Object.fromEntries(moduleNames.map(name => {
    const sample = collectModuleSamples(records, name, now);
    if (sample.accuracy !== null) { pooled.correctWeight += sample.accuracy * sample.sampleQuestions; pooled.questionWeight += sample.sampleQuestions; }
    return [name, sample];
  }));
  const pooledAccuracy = pooled.questionWeight ? pooled.correctWeight / pooled.questionWeight : null;
  if (pooledAccuracy === null) return null;
  const modules = moduleNames.map(name => {
    const { questions, weight, full } = plan.modules[name];
    const sample = stats[name];
    const borrowed = sample.accuracy === null;
    const accuracy = borrowed ? pooledAccuracy : sample.accuracy;
    const allotted = totalSectionSeconds ? durations[name] / totalSectionSeconds * 7200 : 0;
    const completion = sample.pace ? Math.min(1, allotted / (sample.pace * questions)) : 1;
    const expectedCorrect = questions * (completion * accuracy + (1 - completion) * PREDICT_GUESS_RATE);
    return {
      name, questions, weight, full, borrowed,
      accuracy, pace: sample.pace, completion,
      answered: Math.round(questions * completion),
      expectedCorrect,
      score: expectedCorrect * weight,
      grade: getSampleGrade(sample.sampleQuestions),
      gainAccuracy: questions * completion * 0.05 * weight,
      gainSpeed: completion < 1 && accuracy > PREDICT_GUESS_RATE ? questions * (1 - completion) * (accuracy - PREDICT_GUESS_RATE) * weight : 0
    };
  });
  return { modules, total: modules.reduce((sum, module) => sum + module.score, 0), pooledAccuracy };
}

// 各模块的现实正确率上限（公考经验值）：反解目标时不会推荐超过上限的正确率；
// 如果用户当前已高于上限，则以当前水平为上限（只需保持）。
const TARGET_ACCURACY_CAPS = { '资料分析': 0.95, '言语理解': 0.9, '判断推理': 0.92, '数量关系': 0.85, '政治理论': 0.9, '常识判断': 0.8 };

export function getTargetScore() {
  const value = toScore(state.settings.targetScore);
  return value !== null && value > 0 ? value : null;
}

// 把目标总分反解为各模块的目标正确率：
// 需要补的分数按「提升空间 × 完成率 × 分值杠杆」的容量比例分配（水位法），
// 短板模块在绝对百分点上提得更多，高分值模块承担更多分数。
export function buildTargetPlan(prediction, target) {
  const withCaps = prediction.modules.map(module => {
    const cap = Math.max(TARGET_ACCURACY_CAPS[module.name] ?? 0.9, module.accuracy);
    return { ...module, cap, capacity: module.questions * module.completion * (cap - module.accuracy) * module.weight };
  });
  const totalCapacity = withCaps.reduce((sum, module) => sum + module.capacity, 0);
  const delta = target - prediction.total;
  const maxAchievable = withCaps.reduce((sum, m) => sum + m.questions * (m.completion * m.cap + (1 - m.completion) * PREDICT_GUESS_RATE) * m.weight, 0);
  const maxFullSpeed = withCaps.reduce((sum, m) => sum + m.questions * m.cap * m.weight, 0);
  const status = delta <= 0.05 ? 'met' : (delta > totalCapacity + 1e-9 ? 'unreachable' : 'plan');
  const scale = status === 'plan' ? delta / totalCapacity : (status === 'unreachable' ? 1 : 0);
  const modules = withCaps.map(module => {
    const exact = module.accuracy + scale * (module.cap - module.accuracy);
    // 向上取整到整数百分点保证可达成；已达标时直接用当前值，避免取整造成多余的"+1"
    const targetAccuracy = status === 'met' ? module.accuracy : Math.min(module.cap, Math.ceil(exact * 100) / 100);
    const deltaPp = Math.max(0, targetAccuracy - module.accuracy);
    return { name: module.name, grade: module.grade, borrowed: module.borrowed, completion: module.completion, current: module.accuracy, cap: module.cap, target: targetAccuracy, deltaPp, keep: deltaPp < 0.005, targetScore: module.questions * (module.completion * targetAccuracy + (1 - module.completion) * PREDICT_GUESS_RATE) * module.weight };
  });
  return { status, delta, modules, achieved: modules.reduce((sum, m) => sum + m.targetScore, 0), maxAchievable, maxFullSpeed };
}

function formatPercent(value) { return `${Math.round(value * 100)}%`; }

function renderTargetPlan(prediction) {
  const container = $('#predictTargetResult');
  const target = getTargetScore();
  $('#targetScoreInput').value = target ?? '';
  $('#clearTargetScoreBtn').classList.toggle('hidden', target === null);
  if (!container) return;
  if (target === null || !prediction) {
    container.innerHTML = target !== null && !prediction ? '<p class="target-status muted">先积累一些带正确数的训练数据，再来生成模块目标。</p>' : '';
    return;
  }
  const targetPlan = buildTargetPlan(prediction, target);
  let statusHtml = '';
  if (targetPlan.status === 'met') statusHtml = `<p class="target-status met">已达标：当前预测 ${formatPoint(prediction.total)} 分，超出目标 ${formatPoint(prediction.total - target)} 分，按下面的正确率保持即可。</p>`;
  else if (targetPlan.status === 'unreachable') statusHtml = `<p class="target-status warning">目标偏高：按当前速度，即使各模块都到现实上限也只有约 ${formatPoint(targetPlan.maxAchievable)} 分${targetPlan.maxFullSpeed - targetPlan.maxAchievable > 0.5 ? `；若提速到全部答完可到约 ${formatPoint(targetPlan.maxFullSpeed)} 分，建议先补速度` : ''}。下面按上限给出目标。</p>`;
  else statusHtml = `<p class="target-status">距目标还差 ${formatPoint(targetPlan.delta)} 分，按提升空间和分值分配到各模块如下，达成后预计 ${formatPoint(targetPlan.achieved)} 分。</p>`;
  container.innerHTML = statusHtml + `<div class="target-list">${targetPlan.modules.map(module => {
    const badge = module.keep
      ? '<span class="target-delta keep">保持</span>'
      : `<span class="target-delta">+${Math.max(1, Math.round(module.deltaPp * 100))} 个百分点</span>`;
    const capNote = targetPlan.status === 'unreachable' && !module.keep ? '<small class="target-cap">已按上限</small>' : '';
    return `<div class="target-row"><strong>${escapeHTML(module.name)}</strong><span class="target-path"><i>${formatPercent(module.current)}</i><b>→</b><em>${formatPercent(module.target)}</em></span>${badge}${capNote}</div>`;
  }).join('')}</div><p class="target-note">目标正确率指答完部分的正确率（按当前速度估算完成度），已考虑未答完部分 25% 蒙对率。数量关系、常识判断等模块设有现实上限，不会推荐冲不切实际的正确率。</p>`;
}

function saveTargetScore() {
  const raw = $('#targetScoreInput').value;
  if (raw === '') { showToast('请输入 1 - 100 之间的目标分数', 'warning'); return; }
  const value = toScore(raw);
  if (value === null || value <= 0) { showToast('目标分数需在 1 - 100 之间', 'warning'); return; }
  state.settings.targetScore = value;
  if (!saveSettings()) return;
  showToast(`目标分数已设为 ${formatPoint(value)} 分`);
  renderPrediction();
}

function clearTargetScore() {
  state.settings.targetScore = null;
  if (!saveSettings()) return;
  showToast('已清除目标分数');
  renderPrediction();
}

function getRecentMockAverage(records) {
  const scored = records.filter(record => record.module === '行测模考' && toScore(record.score) !== null);
  if (!scored.length) return null;
  return scored.reduce((sum, record) => sum + toScore(record.score), 0) / scored.length;
}

function formatPoint(value) { return (Math.round(value * 10) / 10).toFixed(1); }

function buildAdvice(prediction) {
  const advice = [];
  const speedTarget = [...prediction.modules].sort((a, b) => b.gainSpeed - a.gainSpeed)[0];
  if (speedTarget && speedTarget.gainSpeed >= 0.8) advice.push(`「${speedTarget.name}」按当前速度预计只能答 ${speedTarget.answered}/${speedTarget.questions} 题，提速到答完约可再拿 ${formatPoint(speedTarget.gainSpeed)} 分，是当前最大的提分空间。`);
  const accuracyTarget = [...prediction.modules].filter(module => module !== speedTarget || module.gainSpeed < 0.8).sort((a, b) => b.gainAccuracy - a.gainAccuracy)[0];
  if (accuracyTarget) advice.push(`「${accuracyTarget.name}」单题分值高、题量大，正确率每提高 5 个百分点约多得 ${formatPoint(accuracyTarget.gainAccuracy)} 分。`);
  return advice.slice(0, 2);
}

export function renderPrediction(now = new Date()) {
  const panel = $('#predictHero');
  if (!panel) return;
  const plan = getLevelPlan();
  $$('#predictLevelSwitch [data-predict-level]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.predictLevel === plan.key)));
  let windowUsed = PREDICT_WINDOWS[PREDICT_WINDOWS.length - 1];
  let records = [];
  for (const window of PREDICT_WINDOWS) {
    records = getPeriodRecords(window.days, 0, now);
    const sampleQuestions = getOrderedSectionPresets().reduce((sum, preset) => sum + collectModuleSamples(records, preset.name, now.getTime()).sampleQuestions, 0);
    if (sampleQuestions >= PREDICT_MIN_SAMPLE) { windowUsed = window; break; }
    windowUsed = window;
  }
  const prediction = buildPrediction(records, plan, now.getTime());
  $('#predictPeriodSummary').textContent = `${windowUsed.label} · ${plan.label} ${plan.totalQuestions} 题`;
  if (!prediction) {
    panel.innerHTML = '<div class="empty-state">完成几组带正确数的专项训练或模考模块复盘后，这里会给出预测分数</div>';
    $('#predictList').innerHTML = '';
    $('#predictAdvice').innerHTML = '';
    renderTargetPlan(null);
    return;
  }
  const mockAverage = getRecentMockAverage(records);
  const targetScore = getTargetScore();
  const targetCells = targetScore !== null
    ? `<span><small>目标分数</small><strong>${formatPoint(targetScore)}</strong></span><span><small>距离目标</small><strong class="${prediction.total >= targetScore ? 'target-ok' : 'target-gap'}">${prediction.total >= targetScore ? `已超出 ${formatPoint(prediction.total - targetScore)}` : `还差 ${formatPoint(targetScore - prediction.total)}`}</strong></span>`
    : '';
  const compareHtml = (mockAverage !== null
    ? `<span><small>近期模考均分</small><strong>${formatPoint(mockAverage)}</strong></span><span><small>预测与模考差</small><strong>${prediction.total >= mockAverage ? '+' : ''}${formatPoint(prediction.total - mockAverage)}</strong></span>`
    : `<span><small>近期模考均分</small><strong>暂无</strong></span><span><small>提示</small><strong>做一次行测模考可对照校准</strong></span>`) + targetCells;
  panel.innerHTML = `<div class="predict-score-card"><small>预测行测分数（${escapeHTML(plan.label)}）</small><strong>${formatPoint(prediction.total)}</strong><span>满分 100 · 综合正确率 ${formatAccuracy(Math.round(prediction.pooledAccuracy * 1000), 1000)}</span></div><div class="predict-compare">${compareHtml}</div>`;
  $('#predictList').innerHTML = prediction.modules.map(module => {
    const pressure = module.completion < 0.999;
    const answeredText = pressure ? `预计答 ${module.answered}/${module.questions} 题` : `${module.questions} 题可答完`;
    const accuracyText = `${module.borrowed ? '按整体均值 ' : ''}正确率 ${formatAccuracy(Math.round(module.accuracy * 1000), 1000)}`;
    return `<div class="predict-row"><div class="predict-row-head"><strong>${escapeHTML(module.name)}</strong><span class="predict-badge ${module.grade.key}">${module.grade.label}</span></div><div class="predict-row-meta"><span>${answeredText}${pressure ? ' · 时间紧张' : ''}</span><span>${accuracyText}</span><span>预计对 ${formatPoint(module.expectedCorrect)} 题</span></div><div class="predict-row-score"><div class="predict-bar" role="presentation"><i style="width:${Math.max(3, Math.round(module.score / module.full * 100))}%"></i></div><strong>${formatPoint(module.score)}</strong><small>/ ${formatPoint(module.full)} 分</small></div></div>`;
  }).join('');
  const advice = buildAdvice(prediction);
  $('#predictAdvice').innerHTML = advice.length ? `<h4>提分参考</h4>${advice.map(text => `<p>${escapeHTML(text)}</p>`).join('')}` : '';
  renderTargetPlan(prediction);
}

$('#predictLevelSwitch')?.addEventListener('click', event => {
  const button = event.target.closest('[data-predict-level]');
  if (!button) return;
  state.settings.predictLevel = button.dataset.predictLevel === 'city' ? 'city' : 'deputy';
  saveSettings();
  renderPrediction();
});
$('#saveTargetScoreBtn')?.addEventListener('click', saveTargetScore);
$('#targetScoreInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveTargetScore(); } });
$('#clearTargetScoreBtn')?.addEventListener('click', clearTargetScore);
