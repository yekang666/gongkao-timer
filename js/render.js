import { APP_EVENTS, emitAppEvent } from './app-events.js';
import { $, $$, escapeAttribute, escapeHTML, normalizeLapReviews, saveRecords, state, toScore } from './core.js';
import { addCustomLapReason, getAllLapReasons, isCustomLapReason, removeCustomLapReason } from './reasons.js';
import { formatClock, formatScore, formatShortClock } from './format.js';
import { getLapReviewCounts, getLapStats } from './metrics.js';
import { getMockPacingPlan, isMockPacingActive } from './pacing.js';
import { appConfirm, appPrompt, showToast } from './ui.js';

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
  $('#timerDisplay').setAttribute('aria-disabled', String(state.status !== 'running'));
  $('#startBtn').innerHTML = state.status === 'running' ? 'Ⅱ<span>暂停</span>' : `▶<span>${state.status === 'paused' ? '继续' : '开始'}</span>`;
  $('#finishBtn').innerHTML = state.mode === 'single' ? '✓<span>结束并保存</span>' : '■<span>结束</span>';
  $('#resetBtn').disabled = state.status === 'idle'; $('#finishBtn').disabled = state.status === 'idle';
  $$('.preset-button').forEach(el => el.disabled = state.status === 'running');
  $$('[data-section-group]').forEach(el => el.disabled = state.status === 'running');
  renderLapPanel(); renderPacingStatus();
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

function renderPacingStatus() {
  const status = $('#pacingStatus');
  if (!isMockPacingActive()) { status.classList.add('hidden'); return; }
  const plan = getMockPacingPlan();
  if (!plan.length) { status.classList.add('hidden'); return; }
  const next = plan.find(checkpoint => state.elapsed < checkpoint.at);
  status.classList.remove('hidden');
  if (next) {
    const trackingHint = state.laps.length ? `当前 ${state.laps.length} 题` : '打点后判断是否落后';
    $('#pacingStatusText').textContent = `${formatShortClock(next.at)} 前完成 ${next.module} · 累计 ${next.questions} 题 · ${trackingHint}`;
  } else {
    $('#pacingStatusText').textContent = `已进入最后模块 · 当前打点 ${state.laps.length} 题`;
  }
}

function getLapReviewDraftItem(index) {
  const review = state.lapReviewDraft[index];
  return review ? { status: review.status || null, reason: review.reason || null, note: review.note || '' } : { status: null, reason: null, note: '' };
}

function renderLapReviewInsights(stats) {
  const counts = getLapReviewCounts(state.lapReviewDraft, stats.values.length);
  $('#lapReviewProgress').textContent = `${counts.reviewed} / ${stats.values.length}`;
  const reasonSummary = [...new Set([...getAllLapReasons(), ...Object.keys(counts.reasons)])].filter(reason => counts.reasons[reason]).map(reason => `${reason} ${counts.reasons[reason]} 题`).join(' · ');
  const costlyWrong = stats.values.map((duration, index) => ({ duration, index, review: state.lapReviewDraft[index] })).filter(item => item.review?.status === 'wrong' && item.duration > stats.average);
  const resultSummary = counts.reviewed ? `正确 ${counts.correct} · 错误 ${counts.wrong} · 跳过 ${counts.skipped}` : '尚未标记，可直接关闭后稍后补录';
  const priorityQuestions = costlyWrong.slice(0, 8).map(item => `第 ${item.index + 1} 题`).join('、');
  const prioritySummary = costlyWrong.length ? `优先复盘：${priorityQuestions}${costlyWrong.length > 8 ? `等 ${costlyWrong.length} 题` : ''}（做错且超过平均用时）` : '';
  $('#lapReviewInsights').innerHTML = `<strong>${resultSummary}</strong>${reasonSummary ? `<span>错因：${escapeHTML(reasonSummary)}</span>` : ''}${prioritySummary ? `<span class="priority-review">${prioritySummary}</span>` : ''}`;
}

function renderLapReviewList(record, stats) {
  $('#lapDetailList').innerHTML = stats.values.map((duration, index) => {
    const review = getLapReviewDraftItem(index);
    const ratio = Math.min(100, Math.max(8, duration / stats.slowest * 100));
    const costlyWrong = review.status === 'wrong' && duration > stats.average;
    const marker = costlyWrong ? '<em class="costly">高耗错题</em>' : (index === stats.slowestIndex ? '<em>最慢</em>' : (duration === stats.fastest ? '<em class="fast">最快</em>' : ''));
    const statusButtons = [['correct', '✓ 正确'], ['wrong', '× 错误'], ['skipped', '— 跳过']].map(([status, label]) => `<button type="button" data-review-status="${status}" aria-pressed="${review.status === status}">${label}</button>`).join('');
    const reasonList = getAllLapReasons();
    const reasonOptions = review.reason && !reasonList.includes(review.reason) ? [...reasonList, review.reason] : reasonList;
    const reasonButtons = reasonOptions.map(reason => {
      const pick = `<button type="button" data-review-reason="${escapeAttribute(reason)}" aria-pressed="${review.reason === reason}">${escapeHTML(reason)}</button>`;
      // 自定义标签附带删除按钮（内置错因与历史遗留标签不可删）
      return isCustomLapReason(reason) ? `<span class="lap-reason-custom-wrap">${pick}<button type="button" class="lap-reason-remove" data-remove-reason="${escapeAttribute(reason)}" aria-label="删除自定义错因${escapeAttribute(reason)}">×</button></span>` : pick;
    }).join('') + '<button type="button" class="lap-reason-add" data-review-add-reason aria-label="添加自定义错因">＋ 自定义</button>';
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
  const button = event.target.closest('[data-review-status],[data-review-reason],[data-review-add-reason],[data-remove-reason]'); if (!button) return;
  const card = button.closest('[data-review-index]'), index = Number(card?.dataset.reviewIndex);
  const record = state.records.find(item => item.id === state.reviewingRecordId), stats = getLapStats(record?.laps);
  if (!Number.isInteger(index) || !record || !stats) return;
  const review = getLapReviewDraftItem(index);
  if ('removeReason' in button.dataset) {
    const name = button.dataset.removeReason;
    if (!appConfirm(`删除自定义错因「${name}」？\n历史记录中已标记的「${name}」会保留，只是之后打标时不再显示这个选项。`)) return;
    if (!removeCustomLapReason(name)) return;
    showToast(`已删除错因「${name}」`);
    const scrollTop = $('#lapDetailList').scrollTop; renderLapReviewList(record, stats); $('#lapDetailList').scrollTop = scrollTop;
    return;
  }
  if ('reviewAddReason' in button.dataset) {
    if (review.status !== 'wrong') return;
    const rawName = appPrompt('输入自定义错因（最多 12 字），会保存为常用选项：', '');
    if (rawName === null) return;
    const result = addCustomLapReason(rawName);
    if (result.error) { showToast(result.error, 'warning'); return; }
    review.reason = result.name;
    state.lapReviewDraft[index] = review;
    const scrollTop = $('#lapDetailList').scrollTop; renderLapReviewList(record, stats); $('#lapDetailList').scrollTop = scrollTop;
    return;
  }
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
  const previousReviews = record.lapReviews;
  record.lapReviews = normalizeLapReviews(state.lapReviewDraft, stats.values.length);
  const counts = getLapReviewCounts(record.lapReviews, stats.values.length);
  if (!saveRecords()) { record.lapReviews = previousReviews; return; }
  emitAppEvent(APP_EVENTS.RENDER_STATS); closeLapDetail();
  showToast(counts.reviewed ? `逐题复盘已保存：已标记 ${counts.reviewed}/${stats.values.length} 题` : '记录已保留，可稍后在历史记录中补充逐题复盘');
}

export { closeLapDetail, openLapDetail, render, saveLapReviews, updateLapReviewFromClick, updateLapReviewNote };
