const PRESETS = {
  mock: [
    { name: '行测模考', seconds: 120 * 60 },
    { name: '申论省考', seconds: 150 * 60 },
    { name: '申论国考', seconds: 180 * 60 }
  ],
  section: [
    { name: '资料分析', seconds: 25 * 60 }, { name: '言语理解', seconds: 30 * 60 },
    { name: '判断推理', seconds: 35 * 60 }, { name: '数量关系', seconds: 20 * 60 },
    { name: '政治理论', seconds: 15 * 60 }, { name: '常识判断', seconds: 10 * 60 }
  ],
  single: [{ name: '单题测速', seconds: 0 }]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const STORAGE_RECORDS = 'examTimer.records.v1';
const STORAGE_SETTINGS = 'examTimer.settings.v1';

const state = {
  mode: 'mock', preset: PRESETS.mock[0], duration: PRESETS.mock[0].seconds,
  remaining: PRESETS.mock[0].seconds, elapsed: 0, status: 'idle',
  startedAt: null, tickBase: null, interval: null, autoFinished: false,
  lapTimes: [], records: loadJSON(STORAGE_RECORDS, []),
  settings: { sound: true, dark: false, fontSize: 1, warning: 60, ...loadJSON(STORAGE_SETTINGS, {}) }
};

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveSettings() { localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings)); }
function saveRecords() { localStorage.setItem(STORAGE_RECORDS, JSON.stringify(state.records)); }
function formatClock(total) {
  total = Math.max(0, Math.round(total));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}
function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function renderPresets() {
  const list = $('#presetList'); list.innerHTML = '';
  if (state.mode === 'single') { $('#presetArea').classList.add('hidden'); return; }
  $('#presetArea').classList.remove('hidden');
  PRESETS[state.mode].forEach(preset => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'preset-button';
    if (state.preset.name === preset.name) button.classList.add('active');
    button.innerHTML = `<strong>${preset.name}</strong><span>${preset.seconds / 60} 分钟</span>`;
    button.addEventListener('click', () => selectPreset(preset)); list.appendChild(button);
  });
}

function selectPreset(preset) {
  if (state.status === 'running') return;
  state.preset = preset; state.duration = preset.seconds; resetTimer(false); renderPresets();
}

function setMode(mode) {
  if (mode === state.mode) return;
  stopInterval(); state.mode = mode; state.preset = PRESETS[mode][0]; state.duration = state.preset.seconds;
  state.lapTimes = []; resetTimer(false);
  $$('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
  $('#singleSummary').classList.toggle('hidden', mode !== 'single');
  $('#timerHint').textContent = mode === 'single' ? '每完成一题点击“记一题”，自动保存本题用时' : '建议按正式考试节奏完成，计时结束将自动记录';
  renderPresets(); updateSingleSummary();
}

function startOrPause() {
  if (state.status === 'running') { pauseTimer(); return; }
  if (state.status === 'finished') resetTimer(false);
  state.status = 'running'; state.autoFinished = false;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.tickBase = { at: performance.now(), remaining: state.remaining, elapsed: state.elapsed };
  state.interval = setInterval(tick, 200); tick(); render();
}

function pauseTimer() {
  tick(); stopInterval(); state.status = 'paused'; render();
}

function tick() {
  if (state.status !== 'running') return;
  const delta = (performance.now() - state.tickBase.at) / 1000;
  state.elapsed = state.tickBase.elapsed + delta;
  if (state.mode === 'single') state.remaining = 0;
  else state.remaining = Math.max(0, state.tickBase.remaining - delta);
  if (state.mode !== 'single' && state.remaining <= 0 && !state.autoFinished) {
    state.autoFinished = true; state.remaining = 0; stopInterval(); state.status = 'finished';
    if (state.settings.sound) playBeep();
    saveSession(true, null); showCompletion('时间到，已自动结束', '本次训练已按设定时间保存。');
  }
  render(); updatePip();
}

function resetTimer(confirmNeeded = true) {
  if (confirmNeeded && state.elapsed >= 1 && !confirm('确定重置本轮计时吗？未结束的记录不会保存。')) return;
  stopInterval(); state.remaining = state.duration; state.elapsed = 0; state.startedAt = null; state.status = 'idle'; state.autoFinished = false; render(); updatePip();
}

function requestFinish() {
  if (state.elapsed < 1) return;
  if (state.mode === 'single') { recordLap(); return; }
  pauseTimer(); $('#dialogTitle').textContent = '结束本次训练？';
  $('#dialogMessage').textContent = `已训练 ${formatDuration(state.elapsed)}，保存后将计入复盘数据。`;
  $('#questionInputWrap').classList.remove('hidden'); $('#finishDialog').showModal();
}

function confirmFinish() {
  const questions = Number($('#finishQuestionCount').value) || null;
  saveSession(false, questions); $('#finishDialog').close(); state.status = 'finished'; render(); showToast('训练记录已保存');
}

function recordLap() {
  tick(); if (state.elapsed < .5) return;
  const lap = Math.round(state.elapsed); state.lapTimes.push(lap);
  state.records.unshift({ id: crypto.randomUUID?.() || `${Date.now()}`, mode: 'single', module: '单题测速', duration: lap, planned: null, startedAt: state.startedAt, endedAt: new Date().toISOString(), overtime: false, questions: 1 });
  saveRecords(); stopInterval(); state.elapsed = 0; state.startedAt = null; state.status = 'idle'; updateSingleSummary(); render(); showToast(`已记录本题：${formatClock(lap)}`);
}

function saveSession(auto, questions) {
  if (state.elapsed < 1) return;
  state.records.unshift({ id: crypto.randomUUID?.() || `${Date.now()}`, mode: state.mode, module: state.preset.name, duration: Math.round(state.elapsed), planned: state.duration, startedAt: state.startedAt, endedAt: new Date().toISOString(), overtime: auto || state.elapsed > state.duration, questions });
  state.records = state.records.slice(0, 500); saveRecords(); renderStats();
}

function render() {
  const displaySeconds = state.mode === 'single' ? state.elapsed : state.remaining;
  $('#timerDisplay').textContent = formatClock(displaySeconds);
  $('#sessionTitle').textContent = state.preset.name;
  const statuses = { idle: '准备开始', running: '计时中', paused: '已暂停', finished: '本轮结束' };
  $('#sessionStatus').textContent = statuses[state.status]; $('#statusDot').classList.toggle('running', state.status === 'running');
  const warning = state.mode !== 'single' && state.status === 'running' && state.remaining > 0 && state.remaining <= state.settings.warning;
  $('#timerDisplay').classList.toggle('warning', warning); $('#timerDisplay').classList.toggle('overtime', state.status === 'finished' && state.autoFinished);
  $('#startBtn').innerHTML = state.status === 'running' ? 'Ⅱ<span>暂停</span>' : `▶<span>${state.status === 'paused' ? '继续' : '开始'}</span>`;
  $('#finishBtn').innerHTML = state.mode === 'single' ? '✓<span>记一题</span>' : '■<span>结束</span>';
  $('#resetBtn').disabled = state.status === 'idle'; $('#finishBtn').disabled = state.status === 'idle';
  $$('.preset-button, #customTimeBtn').forEach(el => el.disabled = state.status === 'running');
}

function updateSingleSummary() {
  const count = state.lapTimes.length, avg = count ? state.lapTimes.reduce((a,b)=>a+b,0) / count : 0;
  $('#questionCount').textContent = count; $('#questionAverage').textContent = formatClock(avg).slice(3);
}

function renderStats() {
  const now = new Date(), todayKey = now.toDateString(), weekStart = new Date(now); weekStart.setHours(0,0,0,0); weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const today = state.records.filter(r => new Date(r.endedAt).toDateString() === todayKey);
  const week = state.records.filter(r => new Date(r.endedAt) >= weekStart);
  $('#todayDuration').textContent = formatDuration(today.reduce((n,r)=>n+r.duration,0)); $('#weekCount').textContent = `${week.length} 次`; $('#weekDuration').textContent = formatDuration(week.reduce((n,r)=>n+r.duration,0));
  const modules = PRESETS.section.map(p => p.name); $('#moduleStats').innerHTML = modules.map(name => {
    const rows = state.records.filter(r => r.module === name), avg = rows.length ? rows.reduce((n,r)=>n+r.duration,0)/rows.length : 0, overtime = rows.filter(r=>r.overtime).length;
    return `<div class="module-row"><strong>${name}</strong><span>${rows.length ? formatDuration(avg) : '暂无记录'}</span><span>${overtime} 次超时</span></div>`;
  }).join('');
  $('#historyList').innerHTML = state.records.length ? state.records.slice(0,30).map(r => `<div class="history-row"><div class="history-main"><strong>${r.module}</strong><span class="history-meta">${new Date(r.endedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}${r.questions ? ` · ${r.questions} 题` : ''}${r.overtime ? ' · 超时' : ''}</span></div><strong class="history-duration">${formatClock(r.duration)}</strong><button class="delete-record" data-id="${r.id}" title="删除记录">×</button></div>`).join('') : '<div class="empty-state">完成一次训练后，记录会显示在这里</div>';
  $$('.delete-record').forEach(btn => btn.addEventListener('click', () => { state.records = state.records.filter(r => r.id !== btn.dataset.id); saveRecords(); renderStats(); }));
}

function applySettings() {
  document.body.classList.toggle('dark', state.settings.dark);
  const sizes = ['clamp(4.5rem,9vw,8rem)','clamp(5rem,11vw,9.5rem)','clamp(5.5rem,13vw,11rem)']; document.documentElement.style.setProperty('--timer-size', sizes[state.settings.fontSize]);
  $('#soundToggle').checked = state.settings.sound; $('#themeToggle').checked = state.settings.dark; $('#fontSizeRange').value = state.settings.fontSize; $('#warningRange').value = state.settings.warning;
  $('#fontSizeOutput').textContent = ['紧凑','标准','特大'][state.settings.fontSize]; $('#warningOutput').textContent = `最后 ${state.settings.warning < 60 ? state.settings.warning + ' 秒' : state.settings.warning / 60 + ' 分钟'}`;
}

function playBeep() { try { const ctx = new AudioContext(); [0,.2,.4].forEach(delay => { const o=ctx.createOscillator(),g=ctx.createGain(); o.frequency.value=760;o.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(.18,ctx.currentTime+delay);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+delay+.12);o.start(ctx.currentTime+delay);o.stop(ctx.currentTime+delay+.13); }); } catch {} }
function stopInterval() { clearInterval(state.interval); state.interval = null; }
function showToast(message) { const el=$('#toast'); el.textContent=message;el.classList.remove('hidden');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.add('hidden'),2200); }
function showCompletion(title,message){ $('#dialogTitle').textContent=title;$('#dialogMessage').textContent=message;$('#questionInputWrap').classList.add('hidden');$('#cancelFinishBtn').classList.add('hidden');$('#confirmFinishBtn').textContent='知道了';$('#finishDialog').showModal(); }
function openDrawer(drawer){ closeDrawers();drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');$('#backdrop').classList.remove('hidden'); }
function closeDrawers(){ $$('.drawer').forEach(d=>{d.classList.remove('open');d.setAttribute('aria-hidden','true')});$('#backdrop').classList.add('hidden'); }

let pipWindow = null;
async function togglePip() {
  if (pipWindow) { pipWindow.close(); return; }
  if (!('documentPictureInPicture' in window)) { showToast('当前浏览器不支持悬浮窗口，请使用新版 Chrome 或 Edge'); return; }
  pipWindow = await documentPictureInPicture.requestWindow({ width: 340, height: 180 });
  const style = pipWindow.document.createElement('style'); style.textContent='body{margin:0;background:#18201b;color:#f2f5f2;display:grid;place-items:center;height:100vh;font-family:Segoe UI,sans-serif}.wrap{text-align:center}.time{font:700 48px Consolas,monospace}.name{color:#a9b8ae;margin-bottom:8px}.status{color:#73ae92;font-size:12px;margin-top:8px}'; pipWindow.document.head.append(style);
  pipWindow.document.body.innerHTML='<div class="wrap"><div class="name"></div><div class="time"></div><div class="status"></div></div>'; pipWindow.addEventListener('pagehide',()=>pipWindow=null); updatePip();
}
function updatePip(){ if(!pipWindow)return;pipWindow.document.querySelector('.name').textContent=state.preset.name;pipWindow.document.querySelector('.time').textContent=formatClock(state.mode==='single'?state.elapsed:state.remaining);pipWindow.document.querySelector('.status').textContent={idle:'准备开始',running:'计时中',paused:'已暂停',finished:'本轮结束'}[state.status]; }

$$('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('#startBtn').addEventListener('click', startOrPause); $('#resetBtn').addEventListener('click', () => resetTimer(true)); $('#finishBtn').addEventListener('click', requestFinish);
$('#customTimeBtn').addEventListener('click', () => $('#customTimePanel').classList.toggle('hidden'));
$('#applyTimeBtn').addEventListener('click', () => { const seconds=(+$('#hoursInput').value||0)*3600+(+$('#minutesInput').value||0)*60+(+$('#secondsInput').value||0);if(seconds<1){showToast('自定义时间不能为零');return}state.preset={name:'自定义训练',seconds};state.duration=seconds;resetTimer(false);renderPresets();$('#customTimePanel').classList.add('hidden'); });
$('#confirmFinishBtn').addEventListener('click', () => { if (state.status === 'finished' && state.autoFinished) { $('#finishDialog').close(); $('#cancelFinishBtn').classList.remove('hidden'); $('#confirmFinishBtn').textContent='保存记录'; } else confirmFinish(); });
$('#cancelFinishBtn').addEventListener('click', () => $('#finishDialog').close());
$('#statsBtn').addEventListener('click',()=>{renderStats();openDrawer($('#statsDrawer'))});$('#settingsBtn').addEventListener('click',()=>openDrawer($('#settingsDrawer')));$('#backdrop').addEventListener('click',closeDrawers);$$('.close-drawer').forEach(b=>b.addEventListener('click',closeDrawers));
$('#clearAllBtn').addEventListener('click',()=>{if(state.records.length&&confirm('确定清空全部训练记录吗？此操作无法撤销。')){state.records=[];saveRecords();renderStats();}});
$('#soundToggle').addEventListener('change',e=>{state.settings.sound=e.target.checked;saveSettings()});$('#themeToggle').addEventListener('change',e=>{state.settings.dark=e.target.checked;applySettings();saveSettings()});
$('#fontSizeRange').addEventListener('input',e=>{state.settings.fontSize=+e.target.value;applySettings();saveSettings()});$('#warningRange').addEventListener('input',e=>{state.settings.warning=+e.target.value;applySettings();saveSettings();render()});$('#pipBtn').addEventListener('click',togglePip);
window.addEventListener('beforeunload', stopInterval); applySettings(); renderPresets(); renderStats(); render();
