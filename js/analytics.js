import { $, $$, ANALYTICS_COLORS, MOCK_PACING_QUESTION_COUNTS, PRESETS, SECTION_QUESTION_COUNTS, escapeAttribute, escapeHTML, normalizeLapReviews, normalizeLaps, normalizeModuleResults, state, toNonNegativeInt, toPositiveInt, toScore } from './core.js';
import { formatAccuracy, formatClock, formatDuration, formatScore } from './format.js';
import { getOrderedSectionPresets } from './sections.js';
import { renderStats } from './stats.js';
import { getAccuracyTotals, hasAccuracy } from './timer.js';
import { openDrawer } from './ui.js';

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
    const accessibleDetail = `${label} · ${bucket.metric.hasData ? detail : '暂无数据'}`;
    return `<div class="trend-day${bucket.metric.hasData ? '' : ' no-data'}" role="img" aria-label="${escapeAttribute(accessibleDetail)}" title="${escapeAttribute(accessibleDetail)}"><div class="trend-bar-track"><i style="height:${ratio}%"></i></div><small>${showLabel ? label : ''}</small></div>`;
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
  const records = getPeriodRecords(state.analyticsDays, 0, now), counts = {};
  let wrong = 0;
  records.forEach(record => normalizeLapReviews(record.lapReviews, normalizeLaps(record.laps).length).forEach(review => {
    if (review?.status !== 'wrong') return; wrong += 1; if (review.reason) counts[review.reason] = (counts[review.reason] || 0) + 1;
  }));
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]), max = Math.max(...ranked.map(reason => counts[reason]), 1), reasonTotal = ranked.reduce((sum, reason) => sum + counts[reason], 0);
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
  const views = ['overview', 'trend', 'baseline', 'predict', 'reasons', 'history'];
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

export { getHistoryBenchmark, getModuleAnalytics, getPeriodRecords, openSettingsDrawer, openStatsDrawer, renderPersonalAnalytics, setSettingsView, setStatsView };
