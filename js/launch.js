import { openStatsDrawer } from './analytics.js';
import { PRESETS, state } from './core.js';
import { selectPreset, setMode } from './timer.js';

// 启动参数路由：支持 PWA 桌面快捷方式（manifest shortcuts）直达指定模式。
// 例如 ./?mode=section&preset=ziliao 直接进入资料分析专项，./?view=stats 打开数据复盘。
const PRESET_SLUGS = {
  xingce: '行测模考',
  'shenlun-sheng': '申论省考',
  'shenlun-guo': '申论国考',
  ziliao: '资料分析',
  yanyu: '言语理解',
  panduan: '判断推理',
  shuliang: '数量关系',
  zhengzhi: '政治理论',
  changshi: '常识判断'
};

export function applyLaunchShortcut(recoveredSession) {
  let params;
  try { params = new URLSearchParams(window.location.search); } catch { return; }
  const mode = params.get('mode');
  const presetSlug = params.get('preset');
  const view = params.get('view');
  if (!mode && !view) return;
  // 清掉查询参数，避免刷新页面时重复触发
  try { history.replaceState(null, '', window.location.pathname); } catch {}
  if (view === 'stats') openStatsDrawer();
  // 有恢复的未完成训练时不切换模式，保护未保存的进度（setMode 也会弹确认框，启动时不该出现）
  if (recoveredSession) return;
  if (!['mock', 'section', 'single'].includes(mode)) return;
  if (mode !== state.mode) setMode(mode);
  const presetName = PRESET_SLUGS[presetSlug];
  const preset = presetName ? PRESETS[mode].find(item => item.name === presetName) : null;
  if (preset) selectPreset(preset);
}
