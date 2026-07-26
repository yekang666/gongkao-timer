import { $, LAP_ERROR_REASONS, escapeAttribute, escapeHTML, normalizeText, saveSettings, state } from './core.js';
import { showToast } from './ui.js';

// 自定义错因：内置 9 类之外，用户可添加自己的错因标签。
// 标签只影响打标时的快捷选项；删除标签不会清除历史记录里已保存的错因。
const CUSTOM_REASON_MAX = 12;
const CUSTOM_REASON_LENGTH = 12;

export function normalizeCustomLapReasons(value = state.settings.customLapReasons) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const name = normalizeText(item, CUSTOM_REASON_LENGTH);
    if (!name || seen.has(name) || LAP_ERROR_REASONS.includes(name)) continue;
    seen.add(name);
    normalized.push(name);
    if (normalized.length >= CUSTOM_REASON_MAX) break;
  }
  return normalized;
}

export function getAllLapReasons() {
  return [...LAP_ERROR_REASONS, ...normalizeCustomLapReasons()];
}

export function addCustomLapReason(rawName) {
  const name = normalizeText(rawName, CUSTOM_REASON_LENGTH);
  if (!name) return { error: '错因名称不能为空' };
  if (LAP_ERROR_REASONS.includes(name)) return { name, existed: true };
  const customs = normalizeCustomLapReasons();
  if (customs.includes(name)) return { name, existed: true };
  if (customs.length >= CUSTOM_REASON_MAX) return { error: `自定义错因最多 ${CUSTOM_REASON_MAX} 个，请先在设置中删除不用的` };
  state.settings.customLapReasons = [...customs, name];
  if (!saveSettings()) { state.settings.customLapReasons = customs; return { error: '保存失败，请重试' }; }
  renderCustomReasonSettings();
  return { name, added: true };
}

export function removeCustomLapReason(name) {
  const customs = normalizeCustomLapReasons();
  if (!customs.includes(name)) return false;
  state.settings.customLapReasons = customs.filter(item => item !== name);
  if (!saveSettings()) { state.settings.customLapReasons = customs; return false; }
  renderCustomReasonSettings();
  return true;
}

export function renderCustomReasonSettings() {
  const list = $('#customReasonList');
  if (!list) return;
  const customs = normalizeCustomLapReasons();
  list.innerHTML = customs.length
    ? customs.map(name => `<span class="custom-reason-chip"><b>${escapeHTML(name)}</b><button type="button" data-remove-reason="${escapeAttribute(name)}" aria-label="删除错因${escapeAttribute(name)}">×</button></span>`).join('')
    : '<span class="custom-reason-empty">还没有自定义错因，添加后会出现在逐题复盘的错因选项里。</span>';
  const counter = $('#customReasonCount');
  if (counter) counter.textContent = `${customs.length} / ${CUSTOM_REASON_MAX}`;
}

function submitCustomReason() {
  const input = $('#customReasonInput');
  const result = addCustomLapReason(input.value);
  if (result.error) { showToast(result.error, 'warning'); return; }
  input.value = '';
  showToast(result.existed ? `「${result.name}」已存在` : `已添加错因「${result.name}」`);
}

$('#addCustomReasonBtn')?.addEventListener('click', submitCustomReason);
$('#customReasonInput')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submitCustomReason(); } });
$('#customReasonList')?.addEventListener('click', event => {
  const button = event.target.closest('[data-remove-reason]');
  if (!button) return;
  const name = button.dataset.removeReason;
  if (!confirm(`删除自定义错因「${name}」？\n历史记录中已标记的「${name}」会保留，只是之后打标时不再显示这个选项。`)) return;
  if (removeCustomLapReason(name)) showToast(`已删除错因「${name}」`);
});
renderCustomReasonSettings();
