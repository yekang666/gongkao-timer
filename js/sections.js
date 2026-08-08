import { APP_EVENTS, emitAppEvent } from './app-events.js';
import { $, $$, DEFAULT_SECTION_ORDER, ESSAY_MODULE_NAMES, PRESETS, XINGCE_MODULE_NAMES, saveSettings, state } from './core.js';
import { showToast } from './ui.js';

const PACING_GROUPS = { xingce: XINGCE_MODULE_NAMES, essay: ESSAY_MODULE_NAMES };
const PACING_GROUP_LABELS = { xingce: '行测', essay: '申论' };
let pacingPointerDrag = null;
let pacingLongPressTimer = null;
let pacingAutoScrollFrame = null;

function getPacingGroup(group = state.settings.pacingGroup) {
  return group === 'essay' ? 'essay' : 'xingce';
}

function normalizePlan(group, plan) {
  const allowed = PACING_GROUPS[group];
  const source = Array.isArray(plan) ? plan : allowed;
  return [...new Set(source.filter(name => allowed.includes(name)))];
}

function normalizePacingPlans() {
  const stored = state.settings.pacingPlans;
  const legacyXingce = Array.isArray(state.settings.sectionOrder) ? state.settings.sectionOrder : null;
  const plans = {
    xingce: normalizePlan('xingce', Array.isArray(stored?.xingce) ? stored.xingce : legacyXingce),
    essay: normalizePlan('essay', stored?.essay)
  };
  state.settings.pacingPlans = plans;
  state.settings.sectionOrder = plans.xingce;
  state.settings.pacingGroup = getPacingGroup();
  return plans;
}

function getPacingPlansSnapshot() {
  const plans = normalizePacingPlans();
  return { xingce: [...plans.xingce], essay: [...plans.essay] };
}

function getOrderedSectionPresets(group = 'xingce') {
  const plans = normalizePacingPlans();
  const presetsByName = new Map(PRESETS.section.map(preset => [preset.name, preset]));
  return plans[getPacingGroup(group)].map(name => presetsByName.get(name)).filter(Boolean);
}

function getSectionDurations() {
  const section = state.settings.customDurations?.section || {};
  return Object.fromEntries(PRESETS.section.map(preset => [
    preset.name,
    Number.isFinite(section[preset.name]) && section[preset.name] > 0 ? Math.round(section[preset.name]) : preset.seconds
  ]));
}

function getSectionOrderSnapshot() {
  return getPacingPlansSnapshot().xingce;
}

function getSectionDurationSnapshot() {
  const durations = getSectionDurations();
  $$('[data-section-time]').forEach(input => {
    const minutes = Math.max(1, Math.floor(Number(input.value) || 0));
    if (input.dataset.sectionTime) durations[input.dataset.sectionTime] = minutes * 60;
  });
  return durations;
}

function syncVisibleSectionDurations() {
  const durations = getSectionDurationSnapshot();
  state.settings.customDurations = { ...(state.settings.customDurations || {}), section: durations };
  return durations;
}

function applyCustomDurations() {
  const plans = normalizePacingPlans();
  const sectionDurations = getSectionDurations();
  state.settings.customDurations = { ...(state.settings.customDurations || {}), section: sectionDurations };
  PRESETS.section.forEach(preset => { preset.seconds = sectionDurations[preset.name]; });
  state.settings.pacingPlans = plans;
}

function renderPacingGroupSwitch(group) {
  $$('[data-pacing-group]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.pacingGroup === group));
  });
}

function renderPacingPlan(group) {
  const list = $('#pacingPlanList'), empty = $('#pacingPlanEmpty'), plans = getOrderedSectionPresets(group);
  list.innerHTML = plans.map((preset, index) => `<div class="pacing-plan-card" data-pacing-plan-card data-pacing-name="${preset.name}"><button class="pacing-drag-handle" data-pacing-drag-handle type="button" aria-label="拖动${preset.name}" title="拖动排序">↕</button><span class="pacing-plan-main"><b>${String(index + 1).padStart(2, '0')}</b><strong>${preset.name}</strong><small>${Math.round(preset.seconds / 60)} 分钟 · 纳入节奏</small></span><span class="pacing-plan-actions"><button type="button" data-pacing-move="-1" data-pacing-name="${preset.name}" aria-label="上移${preset.name}" title="上移"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-pacing-move="1" data-pacing-name="${preset.name}" aria-label="下移${preset.name}" title="下移"${index === plans.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-pacing-remove data-pacing-name="${preset.name}" aria-label="移除${preset.name}" title="移出节奏">×</button></span></div>`).join('');
  empty.classList.toggle('hidden', plans.length > 0);
  $('#pacingPlanSummary').textContent = plans.length ? `${plans.length} 个题型 · 按上方顺序提醒` : '暂未加入题型';
}

function renderSectionCatalog(group) {
  const grid = $('#sectionTimeGrid'), plans = getPacingPlansSnapshot()[group], durations = getSectionDurations();
  grid.innerHTML = PACING_GROUPS[group].map(name => {
    const preset = PRESETS.section.find(item => item.name === name), included = plans.includes(name);
    return `<div class="section-time-row pacing-catalog-card${included ? ' included' : ''}" data-pacing-catalog-card data-pacing-name="${name}"><button class="pacing-drag-handle" data-pacing-drag-handle type="button" aria-label="拖动${name}" title="拖入节奏">↕</button><label><span>${name}</span><input data-section-time="${name}" type="number" min="1" max="300" step="1" value="${Math.round(durations[name] / 60)}"><em>分钟</em></label><button class="pacing-add-button" data-pacing-add data-pacing-name="${name}" type="button" aria-label="${included ? `${name}已加入节奏` : `加入${name}到节奏`}" title="${included ? '已加入节奏' : '加入节奏'}"${included ? ' disabled' : ''}>${included ? '✓' : '+'}</button></div>`;
  }).join('');
}

function renderPacingOrderNote(group) {
  const note = $('#pacingOrderNote');
  if (!note) return;
  const names = getOrderedSectionPresets(group).map(preset => preset.name);
  note.textContent = names.length ? `${PACING_GROUP_LABELS[group]}节奏：${names.join(' → ')}` : `${PACING_GROUP_LABELS[group]}暂无已加入题型`;
}

function renderSectionTimeSettings() {
  const group = getPacingGroup();
  renderPacingGroupSwitch(group);
  renderPacingPlan(group);
  renderSectionCatalog(group);
  renderPacingOrderNote(group);
}

function savePacingChanges(message = '') {
  normalizePacingPlans();
  state.pacingNotified = [];
  const saved = saveSettings();
  renderSectionTimeSettings();
  emitAppEvent(APP_EVENTS.RENDER_APP);
  if (message) showToast(saved ? message : `${message}，但未能保存`);
  return saved;
}

function setPacingGroup(group) {
  const nextGroup = getPacingGroup(group);
  syncVisibleSectionDurations();
  state.settings.pacingGroup = nextGroup;
  savePacingChanges();
}

function addPacingPreset(name, index = null) {
  const group = getPacingGroup();
  syncVisibleSectionDurations();
  const plans = normalizePacingPlans(), allowed = PACING_GROUPS[group];
  if (!allowed.includes(name) || plans[group].includes(name)) return;
  const next = [...plans[group]];
  const insertAt = Number.isInteger(index) ? Math.max(0, Math.min(index, next.length)) : next.length;
  next.splice(insertAt, 0, name); plans[group] = next; state.settings.pacingPlans = plans;
  savePacingChanges(`${name}已加入${PACING_GROUP_LABELS[group]}节奏`);
}

function removePacingPreset(name) {
  const group = getPacingGroup();
  syncVisibleSectionDurations();
  const plans = normalizePacingPlans();
  plans[group] = plans[group].filter(item => item !== name); state.settings.pacingPlans = plans;
  savePacingChanges(`${name}已移出${PACING_GROUP_LABELS[group]}节奏`);
}

function movePacingPreset(name, direction) {
  const group = getPacingGroup();
  syncVisibleSectionDurations();
  const plans = normalizePacingPlans(), index = plans[group].indexOf(name), target = index + Number(direction);
  if (index < 0 || target < 0 || target >= plans[group].length) return;
  [plans[group][index], plans[group][target]] = [plans[group][target], plans[group][index]]; state.settings.pacingPlans = plans;
  savePacingChanges();
}

function placePacingPreset(name, targetName = null) {
  const group = getPacingGroup();
  syncVisibleSectionDurations();
  const plans = normalizePacingPlans(), current = plans[group];
  if (!PACING_GROUPS[group].includes(name)) return false;
  const originalIndex = current.indexOf(name), next = current.filter(item => item !== name);
  let insertAt = next.length;
  if (targetName === name && originalIndex >= 0) {
    insertAt = Math.min(originalIndex, next.length);
  } else if (targetName) {
    const targetIndex = next.indexOf(targetName);
    if (targetIndex >= 0) insertAt = targetIndex;
  }
  next.splice(insertAt, 0, name);
  plans[group] = next;
  state.settings.pacingPlans = plans;
  savePacingChanges();
  return true;
}

function clearPacingDragStyles() {
  $$('.dragging,.drop-target').forEach(item => item.classList.remove('dragging', 'drop-target'));
  $('#pacingPlanZone')?.classList.remove('drag-active');
  document.body.classList.remove('pacing-pointer-dragging');
}

function updatePacingPointerTarget(event) {
  $$('.drop-target').forEach(item => item.classList.remove('drop-target'));
  const target = document.elementFromPoint(event.clientX, event.clientY);
  const zone = target?.closest('#pacingPlanZone');
  $('#pacingPlanZone')?.classList.toggle('drag-active', Boolean(zone));
  const targetCard = zone ? target.closest('[data-pacing-plan-card]') : null;
  targetCard?.classList.add('drop-target');
  return { zone, targetName: targetCard?.dataset.pacingName || null };
}

function positionPacingDragPreview(drag) {
  if (!drag.preview) return;
  const left = Math.min(window.innerWidth - drag.preview.offsetWidth - 8, drag.clientX + 12);
  const top = Math.max(8, Math.min(window.innerHeight - drag.preview.offsetHeight - 8, drag.clientY - drag.preview.offsetHeight / 2));
  drag.preview.style.transform = `translate3d(${Math.max(8, left)}px,${top}px,0)`;
}

function runPacingAutoScroll() {
  pacingAutoScrollFrame = null;
  const drag = pacingPointerDrag, drawer = $('#settingsDrawer');
  if (!drag?.active || !drawer?.classList.contains('open')) return;
  const rect = drawer.getBoundingClientRect(), edge = Math.min(160, rect.height * .24);
  const planRect = $('#pacingPlanZone').getBoundingClientRect();
  const visiblePlanHeight = Math.max(0, Math.min(planRect.bottom, rect.bottom) - Math.max(planRect.top, rect.top));
  const planIsReachable = visiblePlanHeight >= Math.min(56, planRect.height);
  let delta = 0;
  const hoveredZone = document.elementFromPoint(drag.clientX, drag.clientY)?.closest('#pacingPlanZone');
  if (!hoveredZone && !planIsReachable && drag.clientY < rect.top + edge) delta = -Math.ceil(18 * (rect.top + edge - drag.clientY) / edge);
  else if (!hoveredZone && !drag.fromCatalog && drag.clientY > rect.bottom - edge) delta = Math.ceil(18 * (drag.clientY - (rect.bottom - edge)) / edge);
  if (delta) {
    const before = drawer.scrollTop;
    drawer.scrollTop += delta;
    if (drawer.scrollTop !== before) updatePacingPointerTarget(drag);
  }
  pacingAutoScrollFrame = requestAnimationFrame(runPacingAutoScroll);
}

function activatePacingPointerDrag(drag) {
  if (!drag || drag.active || pacingPointerDrag !== drag) return;
  drag.active = true;
  drag.card.classList.add('dragging');
  document.body.classList.add('pacing-pointer-dragging');
  drag.preview = document.createElement('div');
  drag.preview.className = 'pacing-drag-preview';
  drag.preview.textContent = drag.name;
  document.body.append(drag.preview);
  positionPacingDragPreview(drag);
  updatePacingPointerTarget(drag);
  if (!pacingAutoScrollFrame) pacingAutoScrollFrame = requestAnimationFrame(runPacingAutoScroll);
}

function stopPacingPointerFeedback(drag) {
  clearTimeout(pacingLongPressTimer);
  pacingLongPressTimer = null;
  if (pacingAutoScrollFrame) cancelAnimationFrame(pacingAutoScrollFrame);
  pacingAutoScrollFrame = null;
  drag?.preview?.remove();
  clearPacingDragStyles();
}

function handlePacingPointerDown(event) {
  if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0) || state.status === 'running') return;
  const handle = event.target.closest('[data-pacing-drag-handle]');
  const card = (handle || event.target).closest('[data-pacing-catalog-card],[data-pacing-plan-card]');
  const interactive = event.target.closest('input,button,select,textarea');
  if (!card || (interactive && !handle)) return;
  event.preventDefault();
  const surface = handle || card;
  pacingPointerDrag = { pointerId: event.pointerId, pointerType: event.pointerType, touchIdentifier: null, surface, card, name: card.dataset.pacingName, fromCatalog: card.hasAttribute('data-pacing-catalog-card'), startX: event.clientX, startY: event.clientY, clientX: event.clientX, clientY: event.clientY, active: false, preview: null };
  surface.setPointerCapture?.(event.pointerId);
  pacingLongPressTimer = setTimeout(() => activatePacingPointerDrag(pacingPointerDrag), 180);
}

function handlePacingPointerMove(event) {
  const drag = pacingPointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
  activatePacingPointerDrag(drag);
  event.preventDefault();
  positionPacingDragPreview(drag);
  updatePacingPointerTarget(event);
}

function handlePacingPointerEnd(event) {
  const drag = pacingPointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (drag.active && event.type === 'pointerup') {
    event.preventDefault();
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    const target = updatePacingPointerTarget(event);
    if (target.zone) placePacingPreset(drag.name, target.targetName);
  }
  if (drag.surface.hasPointerCapture?.(event.pointerId)) drag.surface.releasePointerCapture(event.pointerId);
  pacingPointerDrag = null;
  stopPacingPointerFeedback(drag);
}

function handlePacingTouchStart(event) {
  const touch = event.changedTouches[0];
  if (!touch) return;
  if (pacingPointerDrag?.pointerType === 'touch') {
    pacingPointerDrag.touchIdentifier = touch.identifier;
    return;
  }
  handlePacingPointerDown({
    isPrimary: true, button: 0, pointerType: 'touch', pointerId: `touch-${touch.identifier}`,
    target: event.target, clientX: touch.clientX, clientY: touch.clientY,
    preventDefault: () => event.preventDefault()
  });
  if (pacingPointerDrag) pacingPointerDrag.touchIdentifier = touch.identifier;
}

function handlePacingTouchMove(event) {
  const drag = pacingPointerDrag;
  if (!drag || drag.touchIdentifier === null) return;
  const touch = [...event.touches].find(item => item.identifier === drag.touchIdentifier);
  if (!touch) return;
  handlePacingPointerMove({ pointerId: drag.pointerId, clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => event.preventDefault() });
}

function handlePacingTouchEnd(event) {
  const drag = pacingPointerDrag;
  if (!drag || drag.touchIdentifier === null) return;
  const touch = [...event.changedTouches].find(item => item.identifier === drag.touchIdentifier);
  if (!touch) return;
  handlePacingPointerEnd({ type: event.type === 'touchend' ? 'pointerup' : 'pointercancel', pointerId: drag.pointerId, clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => event.preventDefault() });
}

function saveSectionTimes() {
  syncVisibleSectionDurations();
  savePacingChanges('专项时间已保存');
}

function normalizeSectionOrder(order) {
  const requested = Array.isArray(order) ? order.filter((name, index) => DEFAULT_SECTION_ORDER.includes(name) && order.indexOf(name) === index) : [];
  return [...requested, ...DEFAULT_SECTION_ORDER.filter(name => !requested.includes(name))];
}

function applySectionOrder(order = state.settings.sectionOrder) {
  const normalized = normalizeSectionOrder(order);
  state.settings.sectionOrder = normalized;
  const plans = normalizePacingPlans();
  plans.xingce = normalized;
  state.settings.pacingPlans = plans;
}

export { addPacingPreset, applyCustomDurations, applySectionOrder, getOrderedSectionPresets, getPacingPlansSnapshot, getSectionDurations, getSectionDurationSnapshot, getSectionOrderSnapshot, handlePacingPointerDown, handlePacingPointerEnd, handlePacingPointerMove, handlePacingTouchEnd, handlePacingTouchMove, handlePacingTouchStart, movePacingPreset, normalizeSectionOrder, removePacingPreset, renderSectionTimeSettings, saveSectionTimes, setPacingGroup };
