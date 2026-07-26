import { LAP_ERROR_REASONS, normalizeText, saveSettings, state } from './core.js';

// 自定义错因：内置 9 类之外，用户可添加自己的错因标签。
// 添加与删除都在逐题复盘的打标界面完成（「＋ 自定义」添加、自定义标签上的 × 删除）。
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

export function isCustomLapReason(name) {
  return normalizeCustomLapReasons().includes(name);
}

export function addCustomLapReason(rawName) {
  const name = normalizeText(rawName, CUSTOM_REASON_LENGTH);
  if (!name) return { error: '错因名称不能为空' };
  if (LAP_ERROR_REASONS.includes(name)) return { name, existed: true };
  const customs = normalizeCustomLapReasons();
  if (customs.includes(name)) return { name, existed: true };
  if (customs.length >= CUSTOM_REASON_MAX) return { error: `自定义错因最多 ${CUSTOM_REASON_MAX} 个，可点击标签上的 × 删除不用的` };
  state.settings.customLapReasons = [...customs, name];
  if (!saveSettings()) { state.settings.customLapReasons = customs; return { error: '保存失败，请重试' }; }
  return { name, added: true };
}

export function removeCustomLapReason(name) {
  const customs = normalizeCustomLapReasons();
  if (!customs.includes(name)) return false;
  state.settings.customLapReasons = customs.filter(item => item !== name);
  if (!saveSettings()) { state.settings.customLapReasons = customs; return false; }
  return true;
}
