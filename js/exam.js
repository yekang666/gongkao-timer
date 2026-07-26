import { setSettingsView } from './analytics.js';
import { $, normalizeText, saveSettings, state } from './core.js';
import { getTodayKey, parseDateKey } from './format.js';
import { getDateStamp } from './stats.js';
import { openDrawer, showToast } from './ui.js';

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
  const saved = saveSettings(); renderExamCountdown(); if (saved) showToast('考试倒计时已保存');
}
function checkInExamCountdown() {
  const status = getExamCountdownStatus();
  if (!status.hasDate) { openExamCountdownSettings(); showToast('先设置考试日期', 'warning'); return; }
  if (status.daysLeft < 0) { openExamCountdownSettings(); showToast('考试日期已过，请设置下一场目标', 'warning'); return; }
  if (status.checkedToday) { showToast('今天已经打过卡了'); return; }
  state.settings.examCountdown = normalizeExamCountdown({ ...status.countdown, checkIns: [...status.countdown.checkIns, status.today] });
  const saved = saveSettings(); renderExamCountdown(); if (saved) showToast('今日已打卡，坚持住');
}
function openExamCountdownSettings() {
  openDrawer($('#settingsDrawer'));
  setSettingsView('general');
  setTimeout(() => { ($('#examDateInput')?.value ? $('#examNameInput') : $('#examDateInput'))?.focus(); }, 80);
}

export { checkInExamCountdown, normalizeExamCountdown, openExamCountdownSettings, renderExamCountdown, saveExamCountdownSettings };
