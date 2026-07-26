import { $, $$, FOCUS_SOUND_TYPES, saveSettings, state } from './core.js';
import { showToast } from './ui.js';

const focusAudio = { ctx: null, source: null, gain: null, nodes: [], playing: false, starting: false, startToken: 0, type: null, beepAudio: null, beepUrl: "", alertPrimed: false, alertKeepAliveRequested: false, alertSource: null, alertGain: null };

async function ensureAudioContext(showWarning = false) {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) { if (showWarning) showToast('当前设备暂时无法播放声音', 'warning'); return null; }
  if (focusAudio.ctx && focusAudio.ctx.state === 'closed') focusAudio.ctx = null;
  if (!focusAudio.ctx) {
    try { focusAudio.ctx = new AudioCtor(); }
    catch { if (showWarning) showToast('声音暂时无法启动，请先点一下页面再试', 'warning'); return null; }
    // 被系统打断（弹窗、来电、Siri）后自动尝试恢复；没有手势权限时静默失败，等下次交互再恢复
    focusAudio.ctx.addEventListener('statechange', () => {
      const ctxState = focusAudio.ctx?.state;
      if (focusAudio.playing && ctxState && ctxState !== 'running' && ctxState !== 'closed') {
        setTimeout(() => { try { maybeResumeFocusSound(); } catch {} }, 250);
      }
    });
  }
  if (focusAudio.alertKeepAliveRequested) startAlertKeepAlive(focusAudio.ctx);
  try { if (focusAudio.ctx.state !== 'running' && focusAudio.ctx.state !== 'closed') await focusAudio.ctx.resume(); } catch {}
  if (showWarning && focusAudio.ctx.state !== 'running') showToast('请先点一下页面，再开启声音', 'warning');
  return focusAudio.ctx;
}

async function unlockAudio(showToastOnSuccess = false) {
  focusAudio.alertKeepAliveRequested = true;
  const nativeUnlock = focusAudio.alertPrimed ? Promise.resolve(true) : playNativeBeep({ prime: true });
  const ctx = await ensureAudioContext(false);
  let unlocked = await nativeUnlock;
  if (!ctx || ctx.state !== 'running') {
    if (showToastOnSuccess) showToast(unlocked ? '已准备好提示音；如果听不到，请检查静音开关和媒体音量' : '请先点一下页面，再开启声音', unlocked ? '' : 'warning');
    return unlocked;
  }
  try {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    gain.gain.setValueAtTime(.0001, ctx.currentTime);
    osc.frequency.value = 440; osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + (unlocked ? .025 : .08));
    unlocked = true;
  } catch {}
  focusAudio.alertPrimed = focusAudio.alertPrimed || unlocked;
  if (showToastOnSuccess) showToast('已准备好提示音；如果听不到，请检查静音开关和媒体音量');
  return unlocked;
}

function normalizeFocusSoundSettings(value = state.settings.focusSound) {
  const source = value && typeof value === 'object' ? value : {};
  const type = FOCUS_SOUND_TYPES[source.type] ? source.type : 'pink';
  const volume = Math.max(0, Math.min(100, Math.round(Number.isFinite(Number(source.volume)) ? Number(source.volume) : 28)));
  return { enabled: Boolean(source.enabled), type, volume };
}

function getFocusSoundGainValue(volume = normalizeFocusSoundSettings().volume) {
  return Math.pow(Math.max(0, Math.min(100, volume)) / 100, 1.8) * 0.28;
}

function createNoiseBuffer(ctx, type) {
  const length = Math.max(ctx.sampleRate * 3, 1), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (type === 'pink' || type === 'rain' || type === 'cafe') {
      b0 = .99886 * b0 + white * .0555179; b1 = .99332 * b1 + white * .0750759; b2 = .969 * b2 + white * .153852;
      b3 = .8665 * b3 + white * .3104856; b4 = .55 * b4 + white * .5329522; b5 = -.7616 * b5 - white * .016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * .5362) * .11; b6 = white * .115926;
    } else if (type === 'brown' || type === 'waves') {
      last = (last + .025 * white) / 1.025; data[i] = last * 3.2;
    } else data[i] = white * .48;
  }
  return buffer;
}

function addFocusFilter(ctx, input, filterType, frequency, q = .7) {
  const filter = ctx.createBiquadFilter();
  filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = q;
  input.connect(filter); focusAudio.nodes.push(filter); return filter;
}

function createBeepWavUrl() {
  const sampleRate = 44100, duration = 1.35, sampleCount = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + sampleCount * 2), view = new DataView(buffer);
  const writeString = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  writeString(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); writeString(8, 'WAVE'); writeString(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeString(36, 'data'); view.setUint32(40, sampleCount * 2, true);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate, pulse = t < .24 || (t > .42 && t < .66) || (t > .84 && t < 1.12);
    const edge = Math.min(1, (t % .42) / .035, Math.max(0, (.28 - (t % .42)) / .06));
    const sample = pulse ? Math.sin(2 * Math.PI * 880 * t) * .82 * edge : 0;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
}

function getNativeBeepAudio() {
  if (!focusAudio.beepAudio) {
    focusAudio.beepUrl = createBeepWavUrl();
    focusAudio.beepAudio = new Audio(focusAudio.beepUrl);
    focusAudio.beepAudio.preload = 'auto'; focusAudio.beepAudio.volume = 1; focusAudio.beepAudio.loop = true; focusAudio.beepAudio.playsInline = true;
  }
  return focusAudio.beepAudio;
}

async function playNativeBeep(options = {}) {
  try {
    const { prime = false } = options;
    const audio = getNativeBeepAudio();
    audio.muted = false;
    if (prime) {
      audio.loop = true; audio.volume = .14;
      if (audio.paused) { try { audio.currentTime = 0; } catch {} await audio.play(); }
      setTimeout(() => { try { if (focusAudio.alertKeepAliveRequested) audio.volume = .001; } catch {} }, 130);
    } else {
      audio.loop = false; audio.volume = 1;
      try { audio.currentTime = 0; } catch {}
      if (audio.paused) await audio.play();
      setTimeout(() => {
        try {
          if (focusAudio.alertKeepAliveRequested) { audio.loop = true; audio.volume = .001; audio.play().catch(() => {}); }
          else { audio.pause(); audio.currentTime = 0; audio.volume = 1; }
        } catch {}
      }, 1500);
    }
    focusAudio.alertPrimed = true;
    return true;
  } catch { return false; }
}

function startAlertKeepAlive(ctx = focusAudio.ctx) {
  if (!ctx || focusAudio.alertSource) return Boolean(focusAudio.alertSource);
  try {
    const source = ctx.createOscillator(), gain = ctx.createGain();
    source.frequency.setValueAtTime(22, ctx.currentTime);
    gain.gain.setValueAtTime(.00003, ctx.currentTime);
    source.connect(gain); gain.connect(ctx.destination); source.start();
    Object.assign(focusAudio, { alertSource: source, alertGain: gain });
    return true;
  } catch { return false; }
}

function stopAlertKeepAlive() {
  focusAudio.alertKeepAliveRequested = false;
  try { focusAudio.alertSource?.stop(); } catch {}
  [focusAudio.alertSource, focusAudio.alertGain].forEach(node => { try { node?.disconnect?.(); } catch {} });
  try { focusAudio.beepAudio?.pause(); if (focusAudio.beepAudio) { focusAudio.beepAudio.currentTime = 0; focusAudio.beepAudio.volume = 1; focusAudio.beepAudio.loop = true; } } catch {}
  Object.assign(focusAudio, { alertSource: null, alertGain: null });
}

function showTimeUpNotice() {
  const stage = $('.timer-stage'); if (!stage) return;
  stage.classList.remove('time-up-flash'); void stage.offsetWidth; stage.classList.add('time-up-flash');
  clearTimeout(stage._timeUpTimer); stage._timeUpTimer = setTimeout(() => stage.classList.remove('time-up-flash'), 3600);
}

async function startFocusSound(persist = true) {
  if (focusAudio.starting) return false;
  const startToken = ++focusAudio.startToken; focusAudio.starting = true;
  const settings = normalizeFocusSoundSettings({ ...state.settings.focusSound, enabled: true });
  stopFocusSound(false, false);
  const ctx = await ensureAudioContext(true);
  if (startToken !== focusAudio.startToken) return false;
  if (!ctx || ctx.state !== 'running') {
    state.settings.focusSound = { ...settings, enabled: false };
    if (persist) saveSettings();
    syncFocusSoundUi();
    focusAudio.starting = false; return false;
  }
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = createNoiseBuffer(ctx, settings.type); source.loop = true;
  let node = source;
  if (settings.type === 'brown') node = addFocusFilter(ctx, node, 'lowpass', 1400, .6);
  else if (settings.type === 'rain') { node = addFocusFilter(ctx, node, 'highpass', 850, .55); node = addFocusFilter(ctx, node, 'lowpass', 5200, .8); }
  else if (settings.type === 'waves') node = addFocusFilter(ctx, node, 'lowpass', 720, .7);
  else if (settings.type === 'cafe') { node = addFocusFilter(ctx, node, 'bandpass', 900, .65); node = addFocusFilter(ctx, node, 'lowpass', 2600, .75); }
  else if (settings.type === 'pink') node = addFocusFilter(ctx, node, 'lowpass', 9000, .45);
  const baseGain = getFocusSoundGainValue(settings.volume);
  gain.gain.setValueAtTime(baseGain, ctx.currentTime);
  if (settings.type === 'waves' || settings.type === 'rain' || settings.type === 'cafe') {
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = settings.type === 'waves' ? .08 : settings.type === 'rain' ? .42 : .18;
    lfoGain.gain.value = baseGain * (settings.type === 'waves' ? .55 : .18);
    gain.gain.setValueAtTime(Math.max(.0001, baseGain * (settings.type === 'waves' ? .72 : .9)), ctx.currentTime);
    lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start(); focusAudio.nodes.push(lfo, lfoGain);
  }
  node.connect(gain); gain.connect(ctx.destination); source.start();
  Object.assign(focusAudio, { source, gain, playing: true, starting: false, type: settings.type });
  state.settings.focusSound = settings;
  if (persist) saveSettings();
  syncFocusSoundUi();
  return true;
}

function stopFocusSound(persist = true, cancelPending = true) {
  if (cancelPending) focusAudio.startToken += 1;
  try { focusAudio.source?.stop(); } catch {}
  [focusAudio.source, focusAudio.gain, ...focusAudio.nodes].forEach(node => { try { node?.disconnect?.(); } catch {} });
  Object.assign(focusAudio, { source: null, gain: null, nodes: [], playing: false, type: null }, cancelPending ? { starting: false } : {});
  if (persist) { state.settings.focusSound = { ...normalizeFocusSoundSettings(), enabled: false }; saveSettings(); syncFocusSoundUi(); }
}

function setFocusSoundVolume(volume) {
  const settings = normalizeFocusSoundSettings({ ...state.settings.focusSound, volume });
  state.settings.focusSound = settings; saveSettings();
  if (focusAudio.gain) {
    const now = focusAudio.ctx.currentTime;
    focusAudio.gain.gain.cancelScheduledValues(now);
    focusAudio.gain.gain.setTargetAtTime(getFocusSoundGainValue(settings.volume), now, .08);
  }
  syncFocusSoundUi();
}

function setFocusSoundType(type) {
  if (!FOCUS_SOUND_TYPES[type]) return;
  const wasPlaying = focusAudio.playing || normalizeFocusSoundSettings().enabled;
  state.settings.focusSound = normalizeFocusSoundSettings({ ...state.settings.focusSound, type, enabled: wasPlaying });
  saveSettings(); syncFocusSoundUi();
  if (wasPlaying) startFocusSound(false);
}

async function toggleFocusSound(enabled) {
  if (enabled) await startFocusSound(true);
  else stopFocusSound(true);
}

function maybeResumeFocusSound() {
  const settings = normalizeFocusSoundSettings();
  if (!settings.enabled) return;
  const ctx = focusAudio.ctx;
  if (focusAudio.playing && ctx) {
    if (ctx.state === 'running') return;
    // iOS 弹出系统对话框、来电、Siri 等会把上下文置为 suspended / interrupted；
    // 节点还在，直接 resume 即可无缝续播。上下文被系统关闭时重建。
    if (ctx.state === 'closed') { focusAudio.ctx = null; startFocusSound(false); return; }
    ctx.resume().catch(() => {});
    return;
  }
  if (!focusAudio.playing && !focusAudio.starting) startFocusSound(false);
}

function syncFocusSoundUi() {
  const settings = normalizeFocusSoundSettings(); state.settings.focusSound = settings;
  const toggle = $('#focusSoundToggle'), volume = $('#focusSoundVolume'), output = $('#focusSoundOutput'), status = $('#focusSoundStatus');
  if (toggle) toggle.checked = settings.enabled;
  if (volume) volume.value = settings.volume;
  if (output) output.textContent = settings.volume + '%';
  if (status) status.textContent = focusAudio.playing ? FOCUS_SOUND_TYPES[settings.type].label + '播放中' : (settings.enabled ? '点击页面后恢复播放' : '已关闭');
  $$('[data-focus-sound]').forEach(button => {
    const selected = button.dataset.focusSound === settings.type;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
}

async function playBeep(isTest = false, options = {}) {
  const { keepAliveAfter = false } = options;
  const nativePlayed = playNativeBeep();
  let played = false;
  try {
    const ctx = await ensureAudioContext(isTest);
    if (!ctx || ctx.state !== 'running') {
      if (!played && isTest) showToast('声音暂时没有播放出来，请检查静音开关和媒体音量', 'warning');
      return played;
    }
    [0, .26, .52].forEach(delay => {
      const o = ctx.createOscillator(), g = ctx.createGain(), start = ctx.currentTime + delay;
      o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.001, start);
      g.gain.linearRampToValueAtTime(.36, start + .02);
      g.gain.exponentialRampToValueAtTime(.001, start + .22);
      o.start(start); o.stop(start + .24);
    });
    played = true;
  } catch {
    if (isTest) showToast('声音暂时无法播放，请检查设备声音设置', 'warning');
  }
  played = await nativePlayed || played;
  if (played && !keepAliveAfter) setTimeout(stopAlertKeepAlive, 2600);
  return played;
}

async function warmUpAlertSound() {
  await unlockAudio(false);
  const played = await playBeep(true, { keepAliveAfter: true });
  if (played) showToast('提示音已预热，训练结束时会响铃');
}

export { focusAudio, maybeResumeFocusSound, normalizeFocusSoundSettings, playBeep, setFocusSoundType, setFocusSoundVolume, showTimeUpNotice, stopAlertKeepAlive, stopFocusSound, syncFocusSoundUi, toggleFocusSound, warmUpAlertSound };
