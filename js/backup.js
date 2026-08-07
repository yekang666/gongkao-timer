import { normalizeFocusSoundSettings } from './audio.js';
import { $, PRESETS, STORAGE_RECORDS, STORAGE_SETTINGS, XINGCE_MODULE_NAMES, escapeHTML, normalizeRecords, saveRecords, state } from './core.js';
import { normalizeExamCountdown } from './exam.js';
import { markBackupDone, syncBackupReminderUi } from './backup-reminder.js';
import { render } from './render.js';
import { applyCustomDurations, normalizeSectionOrder, renderSectionTimeSettings } from './sections.js';
import { applySettings, buildSettingsSnapshot, formatExportDateTime, renderDataManagementSummary, renderStats } from './stats.js';
import { renderPresets, resetTimer } from './timer.js';
import { showToast } from './ui.js';

function normalizeImportedData(data) {
  if (Array.isArray(data)) return { settings: buildSettingsSnapshot(), records: normalizeRecords(data).sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()).slice(0, 500), rawRecordCount: data.length };
  if (!data || typeof data !== 'object') throw new Error('文件格式不正确');
  const knownDataFields = ['settings', 'configuration', 'records', 'sectionDurations'];
  if (!knownDataFields.some(field => Object.prototype.hasOwnProperty.call(data, field))) throw new Error('文件中没有可恢复的设置或训练记录');
  if ('settings' in data && (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))) throw new Error('备份中的设置格式不正确');
  if ('configuration' in data && (!data.configuration || typeof data.configuration !== 'object' || Array.isArray(data.configuration))) throw new Error('备份中的配置格式不正确');
  if ('records' in data && !Array.isArray(data.records)) throw new Error('备份中的训练记录格式不正确');
  if ('sectionDurations' in data && (!data.sectionDurations || typeof data.sectionDurations !== 'object' || Array.isArray(data.sectionDurations))) throw new Error('备份中的专项时间格式不正确');
  const importedSettings = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const importedConfiguration = data.configuration && typeof data.configuration === 'object' ? data.configuration : {};
  const importedRecords = Array.isArray(data.records) ? data.records : [];
  const section = importedSettings.customDurations?.section || importedConfiguration.sectionDurations || data.sectionDurations || {};
  const customDurations = { ...(importedSettings.customDurations || {}), section: {} };
  PRESETS.section.filter(preset => XINGCE_MODULE_NAMES.includes(preset.name)).forEach(preset => {
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
  const records = normalizeRecords(importedRecords).sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()).slice(0, 500);
  return { settings: mergedSettings, records, rawRecordCount: importedRecords.length };
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

function buildMergedRecordSet(records, currentRecords = state.records) {
  const current = normalizeRecords(currentRecords);
  const incoming = normalizeRecords(records);
  const existingKeys = new Set(current.map(getRecordMergeKey));
  const seen = new Set();
  const incomingKeys = new Set(incoming.map(getRecordMergeKey));
  const merged = [...current, ...incoming].filter(record => {
    const key = getRecordMergeKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()).slice(0, 500);
  const finalKeys = new Set(merged.map(getRecordMergeKey));
  const added = [...incomingKeys].filter(key => !existingKeys.has(key) && finalKeys.has(key)).length;
  return { records: merged, added };
}

function getMergeableRecordCount(records) {
  return buildMergedRecordSet(records).added;
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
    truncatedCount: Math.max(0, (normalized.rawRecordCount || 0) - normalized.records.length),
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
  const truncatedNote = preview.truncatedCount > 0 ? `<br><strong>注意</strong>：备份共 ${preview.recordCount + preview.truncatedCount} 条记录，超过 500 条保存上限，恢复后只保留最新的 ${preview.recordCount} 条。` : '';
  $('#restorePreviewWarning').innerHTML = `<strong>合并训练记录</strong>：预计新增 ${preview.mergeableRecordCount} 条，当前设置和已有记录不变。<br><strong>覆盖恢复</strong>：用备份中的设置和记录替换当前数据。${truncatedNote}`;
}

function saveImportedData(settings, records) {
  let previousSettings = null, previousRecords = null, snapshotRead = false;
  try {
    previousSettings = localStorage.getItem(STORAGE_SETTINGS);
    previousRecords = localStorage.getItem(STORAGE_RECORDS);
    snapshotRead = true;
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
    localStorage.setItem(STORAGE_RECORDS, JSON.stringify(records));
    return true;
  } catch (error) {
    console.error('备份恢复保存失败', error);
    if (snapshotRead) {
      try {
        if (previousSettings === null) localStorage.removeItem(STORAGE_SETTINGS); else localStorage.setItem(STORAGE_SETTINGS, previousSettings);
        if (previousRecords === null) localStorage.removeItem(STORAGE_RECORDS); else localStorage.setItem(STORAGE_RECORDS, previousRecords);
      } catch (rollbackError) { console.error('备份恢复回滚失败', rollbackError); }
    }
    showToast('恢复失败：浏览器存储空间不足，原有数据已保留');
    return false;
  }
}

function restoreImportedData(data) {
  const nextSettings = data.settings;
  const nextRecords = normalizeRecords(data.records).sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()).slice(0, 500);
  if (!saveImportedData(nextSettings, nextRecords)) return false;
  state.settings = nextSettings; state.records = nextRecords;
  applyCustomDurations();
  if (state.mode === 'section') { const current = PRESETS.section.find(p => p.name === state.preset.name) || PRESETS.section[0]; state.preset = current; state.duration = current.seconds; resetTimer(false); }
  applySettings(); renderSectionTimeSettings(); renderPresets(); renderStats(); render(); renderDataManagementSummary();
  markBackupDone(); // 覆盖恢复后，当前数据与备份文件一致，视为已备份
  syncBackupReminderUi();
  return true;
}

function mergeImportedData(data) {
  const result = buildMergedRecordSet(data.records);
  if (!result.added) return 0;
  const previousRecords = state.records;
  state.records = result.records;
  if (!saveRecords()) { state.records = previousRecords; return null; }
  renderStats(); renderDataManagementSummary();
  return result.added;
}

async function importDataFile(file) {
  if (!file) return;
  try {
    let rawData;
  try { rawData = JSON.parse(await file.text()); } catch { throw new Error('这份备份无法读取'); }
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
    if (added === null) return;
    showToast(added ? `已合并 ${added} 条训练记录` : '没有发现新的训练记录');
  } else {
    if (!restoreImportedData(pendingImport)) return;
    showToast('备份已覆盖恢复');
  }
  state.pendingImport = null;
  $('#restorePreviewDialog').close();
}

function cancelRestoreImport() {
  state.pendingImport = null;
  $('#restorePreviewDialog').close();
}

export { cancelRestoreImport, confirmRestoreImport, importDataFile, normalizeImportedData };
