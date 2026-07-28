import { APP_EVENTS, emitAppEvent } from './app-events.js';
import { $, saveSettings, state } from './core.js';

// 备份提醒：训练数据只保存在本机浏览器里，清缓存即丢失。
// 满足以下任一条件时，启动页顶部显示提醒横幅（可在设置中关闭）：
// 1. 从未备份，且已积累 ≥ 5 条记录；
// 2. 距上次备份 ≥ 7 天，且其后新增 ≥ 3 条记录。
const REMIND_NEVER_MIN_RECORDS = 5;
const REMIND_STALE_DAYS = 7;
const REMIND_NEW_RECORDS = 3;
const SNOOZE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeBackupState(value = state.settings.backupState) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { lastBackupAt: null, snoozedAt: null };
  const toIso = raw => { const time = new Date(raw).getTime(); return Number.isFinite(time) ? new Date(time).toISOString() : null; };
  return { lastBackupAt: toIso(value.lastBackupAt), snoozedAt: toIso(value.snoozedAt) };
}

function isBackupReminderEnabled() { return state.settings.backupReminder !== false; }

function daysSince(iso, now = Date.now()) { return (now - new Date(iso).getTime()) / DAY_MS; }

function countRecordsAfter(iso) {
  const threshold = new Date(iso).getTime();
  return state.records.filter(record => new Date(record.endedAt).getTime() > threshold).length;
}

export function getBackupReminderInfo(now = Date.now()) {
  const backupState = normalizeBackupState();
  if (!isBackupReminderEnabled()) return { due: false, backupState };
  if (backupState.snoozedAt && daysSince(backupState.snoozedAt, now) < SNOOZE_DAYS) return { due: false, backupState };
  if (!backupState.lastBackupAt) {
    if (state.records.length >= REMIND_NEVER_MIN_RECORDS) return { due: true, backupState, message: `已积累 ${state.records.length} 条训练记录，还没有备份过。数据只保存在本机浏览器里，清理缓存会丢失，建议下载一份完整备份。` };
    return { due: false, backupState };
  }
  const staleDays = Math.floor(daysSince(backupState.lastBackupAt, now));
  const newRecords = countRecordsAfter(backupState.lastBackupAt);
  if (staleDays >= REMIND_STALE_DAYS && newRecords >= REMIND_NEW_RECORDS) {
    return { due: true, backupState, message: `距上次备份已 ${staleDays} 天，期间新增 ${newRecords} 条训练记录，建议更新备份。` };
  }
  return { due: false, backupState };
}

export function markBackupDone() {
  state.settings.backupState = { lastBackupAt: new Date().toISOString(), snoozedAt: null };
  saveSettings();
  hideBackupBanner();
  renderLastBackupInfo();
}

function snoozeBackupReminder() {
  const backupState = normalizeBackupState();
  state.settings.backupState = { ...backupState, snoozedAt: new Date().toISOString() };
  saveSettings();
  hideBackupBanner();
}

function hideBackupBanner() { $('#backupBanner')?.classList.add('hidden'); }

export function renderLastBackupInfo() {
  const info = $('#lastBackupInfo');
  if (!info) return;
  const { lastBackupAt } = normalizeBackupState();
  if (!lastBackupAt) { info.textContent = '从未备份'; return; }
  const days = Math.floor(daysSince(lastBackupAt));
  info.textContent = days <= 0 ? '今天' : `${days} 天前`;
}

export function maybeShowBackupReminder() {
  const banner = $('#backupBanner');
  if (!banner) return;
  const reminder = getBackupReminderInfo();
  if (!reminder.due) { banner.classList.add('hidden'); return; }
  $('#backupBannerText').textContent = reminder.message;
  banner.classList.remove('hidden');
}

export function syncBackupReminderUi() {
  const toggle = $('#backupReminderToggle');
  if (toggle) toggle.checked = isBackupReminderEnabled();
  renderLastBackupInfo();
}

$('#backupNowBtn')?.addEventListener('click', () => emitAppEvent(APP_EVENTS.EXPORT_DATA));
$('#backupLaterBtn')?.addEventListener('click', snoozeBackupReminder);
$('#backupReminderToggle')?.addEventListener('change', event => {
  state.settings.backupReminder = event.target.checked;
  saveSettings();
  if (!event.target.checked) hideBackupBanner(); else maybeShowBackupReminder();
});
syncBackupReminderUi();
maybeShowBackupReminder();
