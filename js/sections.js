import { $, $$, DEFAULT_SECTION_ORDER, PRESETS, saveSettings, state } from './core.js';
import { render } from './render.js';
import { renderPresets, resetTimer } from './timer.js';
import { showToast } from './ui.js';

function normalizeSectionOrder(order) {
  const requested = Array.isArray(order) ? order.filter((name, index) => DEFAULT_SECTION_ORDER.includes(name) && order.indexOf(name) === index) : [];
  return [...requested, ...DEFAULT_SECTION_ORDER.filter(name => !requested.includes(name))];
}
function applySectionOrder(order = state.settings.sectionOrder) {
  state.settings.sectionOrder = normalizeSectionOrder(order);
}
function getOrderedSectionPresets() {
  const presetsByName = new Map(PRESETS.section.map(preset => [preset.name, preset]));
  return normalizeSectionOrder(state.settings.sectionOrder).map(name => presetsByName.get(name)).filter(Boolean);
}
function getSectionDurations() {
  const section = state.settings.customDurations?.section || {};
  return Object.fromEntries(PRESETS.section.map(preset => [preset.name, Number.isFinite(section[preset.name]) && section[preset.name] > 0 ? Math.round(section[preset.name]) : preset.seconds]));
}
function getSectionOrderSnapshot() {
  const visibleOrder = typeof getSectionCardOrder === 'function' ? getSectionCardOrder() : [];
  return normalizeSectionOrder(visibleOrder.length ? visibleOrder : state.settings.sectionOrder);
}
function getSectionDurationSnapshot() {
  const visibleDurations = {};
  $$('[data-section-time]').forEach(input => {
    const minutes = Math.max(1, Math.floor(Number(input.value) || 0));
    if (input.dataset.sectionTime) visibleDurations[input.dataset.sectionTime] = minutes * 60;
  });
  const source = Object.keys(visibleDurations).length ? visibleDurations : Object.fromEntries(PRESETS.section.map(preset => [preset.name, preset.seconds]));
  return Object.fromEntries(PRESETS.section.map(preset => {
    const seconds = Number(source[preset.name]);
    return [preset.name, Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : preset.seconds];
  }));
}
function applyCustomDurations() {
  applySectionOrder();
  const sectionDurations = getSectionDurations();
  state.settings.customDurations = { ...(state.settings.customDurations || {}), section: sectionDurations };
  PRESETS.section.forEach(preset => { preset.seconds = sectionDurations[preset.name]; });
}
function renderSectionTimeSettings() {
  const grid = $('#sectionTimeGrid'); if (!grid) return;
  const presets = getOrderedSectionPresets();
  grid.innerHTML = presets.map((preset, index) => `<div class="section-time-row" data-section-card data-section-name="${preset.name}" title="长按后拖动可调整模考顺序"><span class="section-drag-handle" aria-hidden="true">⠿</span><label><span>${preset.name}</span><input data-section-time="${preset.name}" type="number" min="1" max="300" step="1" value="${Math.round(preset.seconds / 60)}"><em>分钟</em></label><span class="section-order-actions"><button data-move-section="-1" type="button" aria-label="上移${preset.name}" title="上移"${index === 0 ? ' disabled' : ''}>↑</button><button data-move-section="1" type="button" aria-label="下移${preset.name}" title="下移"${index === presets.length - 1 ? ' disabled' : ''}>↓</button></span></div>`).join('');
  renderPacingOrderNote();
}

function syncSectionMoveButtons() {
  const cards = $$('#sectionTimeGrid [data-section-card]');
  cards.forEach((card, index) => {
    const up = card.querySelector('[data-move-section="-1"]'), down = card.querySelector('[data-move-section="1"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === cards.length - 1;
  });
}

function moveSectionCard(button) {
  const card = button.closest('[data-section-card]'), direction = Number(button.dataset.moveSection), grid = $('#sectionTimeGrid');
  const target = direction < 0 ? card?.previousElementSibling : card?.nextElementSibling;
  if (!card || !target) return;
  animateSectionGridReflow(() => direction < 0 ? grid.insertBefore(card, target) : grid.insertBefore(target, card));
  state.settings.sectionOrder = normalizeSectionOrder(getSectionCardOrder()); state.pacingNotified = []; const saved = saveSettings();
  syncSectionMoveButtons(); renderPresets(); renderPacingOrderNote(saved ? '答题顺序已调整并保存' : '答题顺序已调整，但未能保存'); button.focus();
}
function renderPacingOrderNote(message = '') {
  const note = $('#pacingOrderNote'); if (!note) return;
  note.textContent = message || `模考顺序：${getOrderedSectionPresets().map(preset => preset.name).join(' → ')}`;
}
function saveSectionTimes() {
  const section = {};
  $$('[data-section-time]').forEach(input => { const minutes = Math.max(1, Math.floor(Number(input.value) || 0)); section[input.dataset.sectionTime] = minutes * 60; input.value = minutes; });
  state.settings.customDurations = { ...(state.settings.customDurations || {}), section };
  applyCustomDurations(); state.pacingNotified = []; const saved = saveSettings();
  if (state.mode === 'section') { const current = PRESETS.section.find(p => p.name === state.preset.name) || PRESETS.section[0]; state.preset = current; state.duration = current.seconds; resetTimer(false); }
  renderSectionTimeSettings(); renderPresets(); render(); if (saved) showToast('专项时间已保存');
}

const sectionSort = { card: null, placeholder: null, timer: null, frame: null, active: false, inputType: null, pointerId: null, touchId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, offsetX: 0, offsetY: 0, originalOrder: [] };

function getSectionCardOrder() { return $$('#sectionTimeGrid [data-section-name]').map(card => card.dataset.sectionName); }
function reorderSectionCards(order) {
  const grid = $('#sectionTimeGrid'), cards = new Map($$('#sectionTimeGrid [data-section-card]').map(card => [card.dataset.sectionName, card]));
  order.forEach(name => { if (cards.has(name)) grid.appendChild(cards.get(name)); });
}
function clearSectionFloatingStyles(card) {
  if (!card) return;
  ['position', 'left', 'top', 'width', 'height', 'margin', 'transform'].forEach(property => card.style.removeProperty(property));
}
function resetSectionSortState() {
  clearTimeout(sectionSort.timer); if (sectionSort.frame) cancelAnimationFrame(sectionSort.frame);
  if (sectionSort.placeholder?.isConnected && sectionSort.card) { sectionSort.placeholder.parentNode.insertBefore(sectionSort.card, sectionSort.placeholder); sectionSort.placeholder.remove(); }
  sectionSort.card?.classList.remove('holding', 'dragging'); clearSectionFloatingStyles(sectionSort.card); $('#sectionTimeGrid').classList.remove('sorting');
  document.body.classList.remove('section-reordering');
  Object.assign(sectionSort, { card: null, placeholder: null, timer: null, frame: null, active: false, inputType: null, pointerId: null, touchId: null, startX: 0, startY: 0, lastX: 0, lastY: 0, offsetX: 0, offsetY: 0, originalOrder: [] });
}
function positionFloatingSectionCard(x, y) {
  sectionSort.lastX = x; sectionSort.lastY = y;
  if (sectionSort.frame) return;
  sectionSort.frame = requestAnimationFrame(() => {
    sectionSort.frame = null; if (!sectionSort.active || !sectionSort.card) return;
    const left = sectionSort.lastX - sectionSort.offsetX, top = sectionSort.lastY - sectionSort.offsetY;
    sectionSort.card.style.transform = `translate3d(${left}px,${top}px,0) scale(1.025)`;
  });
}
function animateSectionGridReflow(change) {
  const cards = $$('#sectionTimeGrid [data-section-card]'), before = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
  change();
  cards.forEach(card => {
    const previous = before.get(card), current = card.getBoundingClientRect(), x = previous.left - current.left, y = previous.top - current.top;
    if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
    card.animate([{ transform: `translate3d(${x}px,${y}px,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}
function activateSectionSort() {
  if (!sectionSort.card) return;
  const card = sectionSort.card, grid = $('#sectionTimeGrid'), rect = card.getBoundingClientRect();
  sectionSort.active = true; sectionSort.originalOrder = getSectionCardOrder(); sectionSort.offsetX = sectionSort.lastX - rect.left; sectionSort.offsetY = sectionSort.lastY - rect.top;
  const placeholder = document.createElement('div'); placeholder.className = 'section-sort-placeholder'; placeholder.dataset.sectionName = card.dataset.sectionName; placeholder.style.height = `${rect.height}px`; sectionSort.placeholder = placeholder;
  grid.insertBefore(placeholder, card); document.body.appendChild(card);
  Object.assign(card.style, { position: 'fixed', left: '0px', top: '0px', width: `${rect.width}px`, height: `${rect.height}px`, margin: '0px', transform: `translate3d(${rect.left}px,${rect.top}px,0) scale(1.025)` });
  sectionSort.card.classList.remove('holding'); sectionSort.card.classList.add('dragging');
  grid.classList.add('sorting'); document.body.classList.add('section-reordering');
  if (sectionSort.inputType === 'pointer' && sectionSort.pointerId !== null) { try { sectionSort.card.setPointerCapture(sectionSort.pointerId); } catch {} }
  if (navigator.vibrate) navigator.vibrate(30);
  renderPacingOrderNote('正在调整：拖到目标位置后松开');
}
function beginSectionSort(card, x, y, inputType, id) {
  resetSectionSortState();
  Object.assign(sectionSort, { card, inputType, startX: x, startY: y, lastX: x, lastY: y, pointerId: inputType === 'pointer' ? id : null, touchId: inputType === 'touch' ? id : null });
  if (inputType === 'pointer') { try { card.setPointerCapture(id); } catch {} }
  card.classList.add('holding'); sectionSort.timer = setTimeout(activateSectionSort, 460);
}
function moveSectionSort(x, y, event) {
  if (!sectionSort.card) return;
  if (!sectionSort.active) {
    sectionSort.lastX = x; sectionSort.lastY = y;
    if (Math.hypot(x - sectionSort.startX, y - sectionSort.startY) > 10) resetSectionSortState();
    return;
  }
  if (event.cancelable) event.preventDefault(); positionFloatingSectionCard(x, y);
  const target = document.elementFromPoint(x, y)?.closest('[data-section-card]');
  if (!target || !$('#sectionTimeGrid').contains(target)) return;
  const grid = $('#sectionTimeGrid'), children = [...grid.children], from = children.indexOf(sectionSort.placeholder), to = children.indexOf(target);
  if (from < 0 || to < 0 || Math.abs(from - to) < 1) return;
  animateSectionGridReflow(() => grid.insertBefore(sectionSort.placeholder, to > from ? target.nextSibling : target));
}
function finishSectionSort(cancelled = false) {
  if (!sectionSort.card) return;
  const wasActive = sectionSort.active, originalOrder = [...sectionSort.originalOrder];
  if (!wasActive) { resetSectionSortState(); renderPacingOrderNote(); return; }
  const card = sectionSort.card, placeholder = sectionSort.placeholder, floatingRect = card.getBoundingClientRect();
  placeholder.parentNode.insertBefore(card, placeholder); placeholder.remove(); sectionSort.placeholder = null; clearSectionFloatingStyles(card); card.classList.remove('dragging');
  if (cancelled) reorderSectionCards(originalOrder);
  const settledRect = card.getBoundingClientRect(), x = floatingRect.left - settledRect.left, y = floatingRect.top - settledRect.top;
  card.animate([{ transform: `translate3d(${x}px,${y}px,0) scale(1.025)`, opacity: .94 }, { transform: 'translate3d(0,0,0) scale(1)', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.85,.2,1)' });
  const order = cancelled ? null : getSectionCardOrder();
  resetSectionSortState();
  if (!order) { renderPacingOrderNote(); return; }
  state.settings.sectionOrder = normalizeSectionOrder(order); applySectionOrder(); state.pacingNotified = []; const saved = saveSettings();
  renderPresets(); render(); renderPacingOrderNote(); if (saved) showToast('模考节奏顺序已保存');
}

export { applyCustomDurations, beginSectionSort, finishSectionSort, getOrderedSectionPresets, getSectionDurationSnapshot, getSectionOrderSnapshot, moveSectionCard, moveSectionSort, normalizeSectionOrder, renderSectionTimeSettings, saveSectionTimes, sectionSort };
