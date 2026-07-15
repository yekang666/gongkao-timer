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
  renderPresets(); updateSingleSummary(); syncMobilePipSource(true);
}

function startOrPause() {
  if (state.status === 'running') { pauseTimer(); return; }
  if (state.status === 'finished') resetTimer(false);
  state.status = 'running'; state.autoFinished = false;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  state.tickBase = { at: performance.now(), remaining: state.remaining, elapsed: state.elapsed };
  state.interval = setInterval(tick, 200); tick(); render(); syncNativeVideoTime(true);
}

function pauseTimer() {
  tick(); stopInterval(); state.status = 'paused'; render(); syncNativeVideoTime(true);
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
  stopInterval(); state.remaining = state.duration; state.elapsed = 0; state.startedAt = null; state.status = 'idle'; state.autoFinished = false; render(); updatePip(); syncMobilePipSource(true);
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
  saveSession(false, questions); $('#finishDialog').close(); state.status = 'finished'; render(); syncNativeVideoTime(true); showToast('训练记录已保存');
}

function recordLap() {
  tick(); if (state.elapsed < .5) return;
  const lap = Math.round(state.elapsed); state.lapTimes.push(lap);
  state.records.unshift({ id: crypto.randomUUID?.() || `${Date.now()}`, mode: 'single', module: '单题测速', duration: lap, planned: null, startedAt: state.startedAt, endedAt: new Date().toISOString(), overtime: false, questions: 1 });
  saveRecords(); stopInterval(); state.elapsed = 0; state.startedAt = null; state.status = 'idle'; updateSingleSummary(); render(); syncMobilePipSource(true); showToast(`已记录本题：${formatClock(lap)}`);
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
let pipStream = null;
let pipFrame = null;
const pipVideo = $('#pipVideo');
const pipCanvas = $('#pipCanvas');
const pipContext = pipCanvas.getContext('2d');
const pipOutputCanvas = $('#pipOutputCanvas');
const pipGl = pipOutputCanvas.getContext('webgl2', { alpha: false, antialias: false }) || pipOutputCanvas.getContext('webgl', { alpha: false, antialias: false });
let pipGlProgram = null;
let pipGlTexture = null;
let pipCaptionTrack = null;
let pipCaptionCue = null;

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function drawVideoPip() {
  const seconds = state.mode === 'single' ? state.elapsed : state.remaining;
  pipContext.fillStyle = '#18201b'; pipContext.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
  pipContext.textAlign = 'center'; pipContext.fillStyle = '#a9b8ae'; pipContext.font = '600 30px sans-serif';
  pipContext.fillText(state.preset.name, pipCanvas.width / 2, 82);
  pipContext.fillStyle = state.status === 'finished' && state.autoFinished ? '#ef756e' : '#f2f5f2';
  pipContext.font = '700 92px monospace'; pipContext.fillText(formatClock(seconds), pipCanvas.width / 2, 215);
  pipContext.fillStyle = '#73ae92'; pipContext.font = '24px sans-serif';
  pipContext.fillText({ idle:'准备开始', running:'计时中', paused:'已暂停', finished:'本轮结束' }[state.status], pipCanvas.width / 2, 292);
  renderWebGlPip();
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return shader;
}

function initWebGlPip() {
  if (!pipGl || pipGlProgram) return;
  const vertex = createShader(pipGl, pipGl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 t;varying vec2 v;void main(){gl_Position=vec4(p,0.,1.);v=t;}');
  const fragment = createShader(pipGl, pipGl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D image;varying vec2 v;void main(){gl_FragColor=texture2D(image,v);}');
  pipGlProgram = pipGl.createProgram(); pipGl.attachShader(pipGlProgram, vertex); pipGl.attachShader(pipGlProgram, fragment); pipGl.linkProgram(pipGlProgram); pipGl.useProgram(pipGlProgram);
  const buffer = pipGl.createBuffer(); pipGl.bindBuffer(pipGl.ARRAY_BUFFER, buffer);
  pipGl.bufferData(pipGl.ARRAY_BUFFER, new Float32Array([-1,-1,0,1, 1,-1,1,1, -1,1,0,0, -1,1,0,0, 1,-1,1,1, 1,1,1,0]), pipGl.STATIC_DRAW);
  const position = pipGl.getAttribLocation(pipGlProgram, 'p'), texture = pipGl.getAttribLocation(pipGlProgram, 't');
  pipGl.enableVertexAttribArray(position); pipGl.vertexAttribPointer(position, 2, pipGl.FLOAT, false, 16, 0);
  pipGl.enableVertexAttribArray(texture); pipGl.vertexAttribPointer(texture, 2, pipGl.FLOAT, false, 16, 8);
  pipGlTexture = pipGl.createTexture(); pipGl.bindTexture(pipGl.TEXTURE_2D, pipGlTexture);
  pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_MIN_FILTER, pipGl.LINEAR); pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_MAG_FILTER, pipGl.LINEAR);
  pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_WRAP_S, pipGl.CLAMP_TO_EDGE); pipGl.texParameteri(pipGl.TEXTURE_2D, pipGl.TEXTURE_WRAP_T, pipGl.CLAMP_TO_EDGE);
}

function renderWebGlPip() {
  if (!pipGl) return;
  initWebGlPip(); pipGl.viewport(0, 0, pipOutputCanvas.width, pipOutputCanvas.height);
  pipGl.bindTexture(pipGl.TEXTURE_2D, pipGlTexture); pipGl.texImage2D(pipGl.TEXTURE_2D, 0, pipGl.RGBA, pipGl.RGBA, pipGl.UNSIGNED_BYTE, pipCanvas);
  pipGl.drawArrays(pipGl.TRIANGLES, 0, 6); pipGl.flush();
}

function keepPipFramesAlive() {
  if (pipFrame) return;
  const refresh = () => { drawVideoPip(); pipFrame = requestAnimationFrame(refresh); };
  pipFrame = requestAnimationFrame(refresh);
}

async function ensureVideoPipSource() {
  if (isAppleMobile()) {
    await syncMobilePipSource(true);
    ensureNativeCaption();
  } else {
    drawVideoPip();
    if (!pipStream) {
      const sourceCanvas = pipGl ? pipOutputCanvas : pipCanvas;
      pipStream = sourceCanvas.captureStream(2);
      pipVideo.srcObject = pipStream;
    }
    keepPipFramesAlive(); await pipVideo.play();
  }
}

async function syncMobilePipSource(force = false) {
  if (!isAppleMobile()) return;
  const source = state.mode === 'single' ? 'pip-stopwatch.mp4' : 'pip-countdown.mp4';
  if (!pipVideo.src.endsWith(source)) {
    pipVideo.srcObject = null; pipVideo.src = source; pipVideo.load();
    await new Promise((resolve, reject) => {
      if (pipVideo.readyState >= 1) { resolve(); return; }
      pipVideo.addEventListener('loadedmetadata', resolve, { once: true });
      pipVideo.addEventListener('error', reject, { once: true });
    });
  }
  syncNativeVideoTime(force); updateNativeCaption();
}

function ensureNativeCaption() {
  if (!pipCaptionTrack) {
    pipCaptionTrack = pipVideo.addTextTrack('captions', '实时计时', 'zh-CN');
    pipCaptionTrack.mode = 'showing';
  }
  updateNativeCaption();
}

function updateNativeCaption() {
  if (!pipCaptionTrack) return;
  if (pipCaptionCue) pipCaptionTrack.removeCue(pipCaptionCue);
  const status = { idle:'准备开始', running:'计时中', paused:'已暂停', finished:'本轮结束' }[state.status];
  const Cue = window.VTTCue || window.TextTrackCue;
  if (!Cue) return;
  pipCaptionCue = new Cue(0, Number.MAX_SAFE_INTEGER, `${state.preset.name}  ·  ${status}`);
  pipCaptionCue.align = 'center'; pipCaptionCue.line = 88; pipCaptionCue.size = 70;
  pipCaptionTrack.addCue(pipCaptionCue);
}

function syncNativeVideoTime(force = false) {
  if (!isAppleMobile() || !pipVideo.src) return;
  const target = state.mode === 'single' ? Math.min(state.elapsed, 10800) : Math.max(0, 10800 - Math.min(state.remaining, 10800));
  if (force || Math.abs(pipVideo.currentTime - target) > 1.4) pipVideo.currentTime = target;
  if (state.status === 'running') pipVideo.play().catch(() => {});
  else pipVideo.pause();
}

function supportsSafariPip() {
  return typeof pipVideo.webkitSetPresentationMode === 'function' &&
    (!pipVideo.webkitSupportsPresentationMode || pipVideo.webkitSupportsPresentationMode('picture-in-picture'));
}

async function toggleVideoPip() {
  await ensureVideoPipSource();
  if (supportsSafariPip()) {
    const leaving = pipVideo.webkitPresentationMode === 'picture-in-picture';
    pipVideo.webkitSetPresentationMode(leaving ? 'inline' : 'picture-in-picture');
    if (!leaving) syncNativeVideoTime(true);
    if (!leaving && isAppleMobile()) showToast('已开启画中画，可返回桌面或切换应用');
    return;
  }
  if (document.pictureInPictureEnabled && pipVideo.requestPictureInPicture) {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await pipVideo.requestPictureInPicture();
    return;
  }
  throw new Error('Picture-in-Picture unavailable');
}

async function togglePip() {
  try {
    if (pipWindow) { pipWindow.close(); return; }
    if ('documentPictureInPicture' in window && !isAppleMobile()) {
      pipWindow = await documentPictureInPicture.requestWindow({ width: 340, height: 180 });
      const style = pipWindow.document.createElement('style'); style.textContent='body{margin:0;background:#18201b;color:#f2f5f2;display:grid;place-items:center;height:100vh;font-family:Segoe UI,sans-serif}.wrap{text-align:center}.time{font:700 48px Consolas,monospace}.name{color:#a9b8ae;margin-bottom:8px}.status{color:#73ae92;font-size:12px;margin-top:8px}'; pipWindow.document.head.append(style);
      pipWindow.document.body.innerHTML='<div class="wrap"><div class="name"></div><div class="time"></div><div class="status"></div></div>'; pipWindow.addEventListener('pagehide',()=>pipWindow=null); updatePip(); return;
    }
    await toggleVideoPip();
  } catch {
    showToast(isAppleMobile() ? '请在系统设置中开启“自动画中画”，并使用 Safari 打开' : '当前浏览器不支持悬浮计时');
  }
}
function updatePip(){
  drawVideoPip();
  syncNativeVideoTime();
  updateNativeCaption();
  if(!pipWindow)return;
  pipWindow.document.querySelector('.name').textContent=state.preset.name;pipWindow.document.querySelector('.time').textContent=formatClock(state.mode==='single'?state.elapsed:state.remaining);pipWindow.document.querySelector('.status').textContent={idle:'准备开始',running:'计时中',paused:'已暂停',finished:'本轮结束'}[state.status];
}

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
