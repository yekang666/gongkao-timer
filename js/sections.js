import { APP_EVENTS, emitAppEvent } from './app-events.js';
import { $, $$, DEFAULT_SECTION_ORDER, ESSAY_MODULE_NAMES, PRESETS, XINGCE_MODULE_NAMES, saveSettings, state } from './core.js';
import { showToast } from './ui.js';

const PACING_GROUPS = { xingce: XINGCE_MODULE_NAMES, essay: ESSAY_MODULE_NAMES };
const PACING_GROUP_LABELS = { xingce: '行测', essay: '申论' };
const PACING_NAME_ALIASES = { '申论概括题': '概括题' };
let pacingReorder = null;
let pacingReorderTimer = null;

function getPacingGroup(group = state.settings.pacingGroup) {
  return group === 'essay' ? 'essay' : 'xingce';
}

function normalizePlan(group, plan) {
  const allowed = PACING_GROUPS[group];
  const source = Array.isArray(plan) ? plan : allowed;
  return [...new Set(source.map(name => PACING_NAME_ALIASES[name] || name).filter(name => allowed.includes(name)))];
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
  list.innerHTML = plans.map((preset, index) => `<div class="pacing-plan-card" data-pacing-plan-card data-pacing-name="${preset.name}"><span class="pacing-plan-main"><b>${String(index + 1).padStart(2, '0')}</b><strong>${preset.name}</strong><small>${Math.round(preset.seconds / 60)} 分钟 · 纳入节奏</small></span><span class="pacing-plan-actions"><button type="button" data-pacing-move="-1" data-pacing-name="${preset.name}" aria-label="上移${preset.name}" title="上移"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-pacing-move="1" data-pacing-name="${preset.name}" aria-label="下移${preset.name}" title="下移"${index === plans.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-pacing-remove data-pacing-name="${preset.name}" aria-label="移除${preset.name}" title="移出节奏">×</button></span></div>`).join('');
  empty.classList.toggle('hidden', plans.length > 0);
  $('#pacingPlanSummary').textContent = plans.length ? `${plans.length} 个题型 · 按上方顺序提醒` : '暂未加入题型';
}

function renderSectionCatalog(group) {
  const grid = $('#sectionTimeGrid'), plans = getPacingPlansSnapshot()[group], durations = getSectionDurations();
  grid.innerHTML = PACING_GROUPS[group].map(name => {
    const preset = PRESETS.section.find(item => item.name === name), included = plans.includes(name);
    return `<div class="section-time-row pacing-catalog-card${included ? ' included' : ''}" data-pacing-catalog-card data-pacing-name="${name}"><label><span>${name}</span><input data-section-time="${name}" type="number" min="1" max="300" step="1" value="${Math.round(durations[name] / 60)}"><em>分钟</em></label><button class="pacing-add-button" data-pacing-add data-pacing-name="${name}" type="button" aria-label="${included ? `${name}已加入节奏` : `加入${name}到节奏`}" title="${included ? '已加入节奏' : '加入节奏'}"${included ? ' disabled' : ''}>${included ? '✓' : '+'}</button></div>`;
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

function reorderPacingPreset(name, targetIndex) {
  const group = getPacingGroup();
  syncVisibleSectionDurations();
  const plans = normalizePacingPlans(), current = plans[group], sourceIndex = current.indexOf(name);
  if (sourceIndex < 0) return;
  const next = current.filter(item => item !== name);
  next.splice(Math.max(0, Math.min(Number(targetIndex) || 0, next.length)), 0, name);
  plans[group] = next;
  state.settings.pacingPlans = plans;
  savePacingChanges();
}

function positionPacingReorderPreview(drag) {
  if (!drag.preview) return;
  const left = Math.min(window.innerWidth - drag.preview.offsetWidth - 8, drag.clientX + 12);
  const top = Math.max(8, Math.min(window.innerHeight - drag.preview.offsetHeight - 8, drag.clientY - drag.preview.offsetHeight / 2));
  drag.preview.style.transform = `translate3d(${Math.max(8, left)}px,${top}px,0)`;
}

function updatePacingReorderPosition(drag) {
  if (!drag.active) return;
  const list = $('#pacingPlanList');
  const cards = $$('[data-pacing-plan-card]').filter(card => card !== drag.card);
  let targetIndex = cards.findIndex(card => drag.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2);
  if (targetIndex < 0) targetIndex = cards.length;
  const listRect = list.getBoundingClientRect();
  const anchorRect = targetIndex < cards.length ? cards[targetIndex].getBoundingClientRect() : cards.at(-1)?.getBoundingClientRect();
  const top = targetIndex < cards.length ? anchorRect.top - 3 : (anchorRect?.bottom || listRect.top) + 3;
  drag.targetIndex = targetIndex;
  drag.indicator.style.width = `${Math.max(0, listRect.width - 12)}px`;
  drag.indicator.style.transform = `translate3d(${listRect.left + 6}px,${top}px,0)`;
  drag.indicator.firstElementChild.textContent = `第 ${targetIndex + 1} 位`;
  positionPacingReorderPreview(drag);
}

function activatePacingReorder(drag) {
  if (!drag || drag.active || pacingReorder !== drag) return;
  drag.active = true;
  drag.card.classList.add('reordering');
  document.body.classList.add('pacing-reordering');
  drag.preview = document.createElement('div');
  drag.preview.className = 'pacing-reorder-preview';
  drag.preview.textContent = drag.name;
  drag.indicator = document.createElement('div');
  drag.indicator.className = 'pacing-position-indicator';
  drag.indicator.innerHTML = '<span></span>';
  document.body.append(drag.preview, drag.indicator);
  updatePacingReorderPosition(drag);
}

function clearPacingReorder(drag) {
  clearTimeout(pacingReorderTimer);
  pacingReorderTimer = null;
  drag?.preview?.remove();
  drag?.indicator?.remove();
  drag?.card?.classList.remove('reordering');
  document.body.classList.remove('pacing-reordering');
}

function handlePacingReorderPointerDown(event) {
  if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0) || state.status === 'running') return;
  if (event.target.closest('button,input,select,textarea')) return;
  const card = event.target.closest('[data-pacing-plan-card]');
  if (!card) return;
  event.preventDefault();
  pacingReorder = { pointerId: event.pointerId, pointerType: event.pointerType, touchIdentifier: null, card, name: card.dataset.pacingName, clientX: event.clientX, clientY: event.clientY, targetIndex: 0, active: false, preview: null, indicator: null };
  card.setPointerCapture?.(event.pointerId);
  pacingReorderTimer = setTimeout(() => activatePacingReorder(pacingReorder), 220);
}

function handlePacingReorderPointerMove(event) {
  const drag = pacingReorder;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  if (!drag.active) return;
  event.preventDefault();
  updatePacingReorderPosition(drag);
}

function handlePacingReorderPointerEnd(event) {
  const drag = pacingReorder;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const shouldReorder = drag.active && event.type === 'pointerup';
  const targetIndex = drag.targetIndex;
  if (drag.card.hasPointerCapture?.(event.pointerId)) drag.card.releasePointerCapture(event.pointerId);
  pacingReorder = null;
  clearPacingReorder(drag);
  if (shouldReorder) reorderPacingPreset(drag.name, targetIndex);
}

function handlePacingReorderTouchStart(event) {
  const touch = event.changedTouches[0];
  if (!touch) return;
  if (pacingReorder?.pointerType === 'touch') {
    pacingReorder.touchIdentifier = touch.identifier;
    return;
  }
  handlePacingReorderPointerDown({ isPrimary: true, button: 0, pointerType: 'touch', pointerId: `touch-${touch.identifier}`, target: event.target, clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => event.preventDefault() });
  if (pacingReorder) pacingReorder.touchIdentifier = touch.identifier;
}

function handlePacingReorderTouchMove(event) {
  const drag = pacingReorder;
  if (!drag || drag.touchIdentifier === null) return;
  const touch = [...event.touches].find(item => item.identifier === drag.touchIdentifier);
  if (touch) handlePacingReorderPointerMove({ pointerId: drag.pointerId, clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => event.preventDefault() });
}

function handlePacingReorderTouchEnd(event) {
  const drag = pacingReorder;
  if (!drag || drag.touchIdentifier === null) return;
  const touch = [...event.changedTouches].find(item => item.identifier === drag.touchIdentifier);
  if (touch) handlePacingReorderPointerEnd({ type: event.type === 'touchend' ? 'pointerup' : 'pointercancel', pointerId: drag.pointerId });
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

export { addPacingPreset, applyCustomDurations, applySectionOrder, getOrderedSectionPresets, getPacingPlansSnapshot, getSectionDurations, getSectionDurationSnapshot, getSectionOrderSnapshot, handlePacingReorderPointerDown, handlePacingReorderPointerEnd, handlePacingReorderPointerMove, handlePacingReorderTouchEnd, handlePacingReorderTouchMove, handlePacingReorderTouchStart, movePacingPreset, normalizeSectionOrder, removePacingPreset, renderSectionTimeSettings, saveSectionTimes, setPacingGroup };
