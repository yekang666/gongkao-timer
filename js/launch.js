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
  changshi: '常识判断',
  'shenlun-gaikuo': '概括题',
  'shenlun-fenxi': '分析理解题',
  'shenlun-duice': '提出对策题',
  'shenlun-gongwen': '公文题',
  'shenlun-xiezuo': '写作'
};

function isStandaloneApp() {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; }
}

export function applyLaunchShortcut(recoveredSession) {
  const search = window.location.search;
  let params;
  try { params = new URLSearchParams(search); } catch { return; }
  const mode = params.get('mode');
  const presetSlug = params.get('preset');
  const view = params.get('view');
  if (!mode && !view) return;
  if (isStandaloneApp()) {
    // 已安装的 App 里由 manifest shortcuts 进入：清掉参数即可
    try { history.replaceState(null, '', window.location.pathname); } catch {}
  } else {
    // 浏览器模式保留参数：iOS 不支持长按快捷菜单，用户可以把带参数的网址
    // 「添加到主屏幕」或收藏，做成单独的直达图标。
    // 用 sessionStorage 防止同一个标签页刷新时被反复拉回参数指定的模式。
    try {
      if (sessionStorage.getItem('examTimer.launchApplied') === search) return;
      sessionStorage.setItem('examTimer.launchApplied', search);
    } catch {}
  }
  if (view === 'stats') openStatsDrawer();
  // 有恢复的未完成训练时不切换模式，保护未保存的进度（setMode 也会弹确认框，启动时不该出现）
  if (recoveredSession) return;
  if (!['mock', 'section', 'single'].includes(mode)) return;
  if (mode !== state.mode) setMode(mode);
  const presetName = PRESET_SLUGS[presetSlug];
  const preset = presetName ? PRESETS[mode].find(item => item.name === presetName) : null;
  if (preset) selectPreset(preset);
}
