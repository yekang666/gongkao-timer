import { normalizeImportedData } from './backup.js';
import { $, state } from './core.js';
import { formatClock } from './format.js';
import { buildExportData, buildRecordsCsv } from './stats.js';
import { resetTimer } from './timer.js';
import { showToast } from './ui.js';

let pipWindow = null;
let pipStream = null;
let pipFrame = null;
const pipVideo = $('#pipVideo');
const pipCanvas = $('#pipCanvas');
const pipContext = pipCanvas.getContext('2d');
const pipOutputCanvas = $('#pipOutputCanvas');
let pipGl = null;
let pipGlProgram = null;
let pipGlTexture = null;
let pipCaptionTrack = null;
let pipCaptionCue = null;
let mobilePipSyncTimer = null;

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function drawVideoPip() {
  const isOvertime = state.mode !== 'single' && state.autoFinished;
  const seconds = state.mode === 'single' ? state.elapsed : (isOvertime ? Math.max(0, state.elapsed - state.duration) : state.remaining);
  pipContext.fillStyle = '#18201b'; pipContext.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
  pipContext.textAlign = 'center'; pipContext.fillStyle = '#a9b8ae'; pipContext.font = '600 30px sans-serif';
  pipContext.fillText(state.preset.name, pipCanvas.width / 2, 82);
  pipContext.fillStyle = isOvertime ? '#ef756e' : '#f2f5f2';
  pipContext.font = '700 92px monospace'; pipContext.fillText(formatClock(seconds), pipCanvas.width / 2, 215);
  pipContext.fillStyle = isOvertime ? '#ef756e' : '#73ae92'; pipContext.font = '24px sans-serif';
  pipContext.fillText({ idle:'准备开始', running:isOvertime ? '已超时' : '计时中', paused:isOvertime ? '超时暂停' : '已暂停', finished:'本轮结束' }[state.status], pipCanvas.width / 2, 292);
  renderWebGlPip();
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return shader;
}

function initWebGlPip() {
  if (pipGlProgram) return;
  pipGl = pipOutputCanvas.getContext('webgl2', { alpha: false, antialias: false }) || pipOutputCanvas.getContext('webgl', { alpha: false, antialias: false });
  if (!pipGl) return;
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
  initWebGlPip();
  if (!pipGl || !pipGlProgram) return;
  pipGl.viewport(0, 0, pipOutputCanvas.width, pipOutputCanvas.height);
  pipGl.bindTexture(pipGl.TEXTURE_2D, pipGlTexture); pipGl.texImage2D(pipGl.TEXTURE_2D, 0, pipGl.RGBA, pipGl.RGBA, pipGl.UNSIGNED_BYTE, pipCanvas);
  pipGl.drawArrays(pipGl.TRIANGLES, 0, 6); pipGl.flush();
}

function keepPipFramesAlive() {
  if (pipFrame) return;
  drawVideoPip(); pipFrame = setInterval(drawVideoPip, 500);
}

function stopPipFrames() {
  clearInterval(pipFrame); pipFrame = null;
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
  const source = (state.mode === 'single' || state.autoFinished) ? 'pip-stopwatch.mp4' : 'pip-countdown.mp4';
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
  const isOvertime = state.mode !== 'single' && state.autoFinished;
  const status = { idle:'准备开始', running:isOvertime ? '已超时' : '计时中', paused:isOvertime ? '超时暂停' : '已暂停', finished:'本轮结束' }[state.status];
  const Cue = window.VTTCue || window.TextTrackCue;
  if (!Cue) return;
  pipCaptionCue = new Cue(0, Number.MAX_SAFE_INTEGER, `${state.preset.name}  ·  ${status}`);
  pipCaptionCue.align = 'center'; pipCaptionCue.line = 88; pipCaptionCue.size = 70;
  pipCaptionTrack.addCue(pipCaptionCue);
}

function getMobilePipTargetTime() {
  const displaySeconds = state.mode === 'single' ? state.elapsed : (state.autoFinished ? Math.max(0, state.elapsed - state.duration) : state.remaining);
  const rounded = Math.max(0, Math.round(displaySeconds));
  return (state.mode === 'single' || state.autoFinished) ? Math.min(rounded, 10800) : Math.max(0, 10800 - Math.min(rounded, 10800));
}

function syncNativeVideoTime(force = false) {
  if (!isAppleMobile() || !pipVideo.src || pipVideo.readyState < 1) return;
  const target = getMobilePipTargetTime();
  const threshold = state.status === 'running' ? 0.25 : 0.05;
  if (force || Math.abs(pipVideo.currentTime - target) > threshold) pipVideo.currentTime = target;
  if (state.status === 'running') pipVideo.play().catch(() => {});
  else pipVideo.pause();
}

function startMobilePipSyncLoop() {
  if (mobilePipSyncTimer || !isAppleMobile()) return;
  mobilePipSyncTimer = setInterval(() => syncNativeVideoTime(false), 250);
}

function stopMobilePipSyncLoop() {
  clearInterval(mobilePipSyncTimer); mobilePipSyncTimer = null;
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
    if (leaving) { stopMobilePipSyncLoop(); stopPipFrames(); }
    else { syncNativeVideoTime(true); startMobilePipSyncLoop(); }
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
      pipWindow.document.body.innerHTML='<div class="wrap"><div class="name"></div><div class="time"></div><div class="status"></div></div>'; pipWindow.addEventListener('pagehide',()=>{pipWindow=null;stopPipFrames()}); updatePip(); return;
    }
    await toggleVideoPip();
  } catch {
    showToast(isAppleMobile() ? '请在系统设置中开启“自动画中画”，并使用 Safari 打开' : '当前设备暂不支持悬浮计时');
  }
}
window.state = state;
window.resetTimer = resetTimer;
window.buildExportData = buildExportData;
window.buildRecordsCsv = buildRecordsCsv;
window.normalizeImportedData = normalizeImportedData;
window.syncNativeVideoTime = syncNativeVideoTime;
window.getMobilePipTargetTime = getMobilePipTargetTime;

function updatePip(){
  const nativePipActive = pipVideo.webkitPresentationMode === 'picture-in-picture' || document.pictureInPictureElement === pipVideo;
  if (!pipWindow && !nativePipActive) return;
  if (pipWindow || !isAppleMobile()) drawVideoPip();
  if (nativePipActive) { syncNativeVideoTime(); updateNativeCaption(); }
  if(!pipWindow)return;
  pipWindow.document.querySelector('.name').textContent=state.preset.name;pipWindow.document.querySelector('.time').textContent=formatClock(state.mode==='single'?state.elapsed:state.remaining);pipWindow.document.querySelector('.status').textContent={idle:'准备开始',running:'计时中',paused:'已暂停',finished:'本轮结束'}[state.status];
}

export { pipVideo, stopMobilePipSyncLoop, stopPipFrames, syncMobilePipSource, syncNativeVideoTime, togglePip, updatePip };
