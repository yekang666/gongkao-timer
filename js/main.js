import { openSettingsDrawer, openStatsDrawer, setSettingsView, setStatsView } from './analytics.js';
import { maybeResumeFocusSound, setFocusSoundType, setFocusSoundVolume, stopAlertKeepAlive, stopFocusSound, toggleFocusSound, warmUpAlertSound } from './audio.js';
import { cancelRestoreImport, confirmRestoreImport, importDataFile } from './backup.js';
import { applyLaunchShortcut } from './launch.js';
import { $, $$, persistActiveSession, restoreActiveSession, saveRecords, saveSettings, state } from './core.js';
import { checkInExamCountdown, openExamCountdownSettings, saveExamCountdownSettings } from './exam.js';
import { editMockReport, finishMockModuleReview, finishTrainingMeta, openReportLapReview, returnFromMockModuleReview, returnToTrainingPreviousStep } from './mock.js';
import { pipVideo, stopMobilePipSyncLoop, stopPipFrames, syncNativeVideoTime, togglePip } from './pip.js';
import { closeRecordCreator, closeRecordEditor, openRecordCreator, openRecordFromHistoryEvent, openRecordFromHistoryKey, saveRecordCreator, saveRecordEditor, setDifficultyChoice } from './records.js';
import { closeLapDetail, render, saveLapReviews, updateLapReviewFromClick, updateLapReviewNote } from './render.js';
import { applyCustomDurations, beginSectionSort, finishSectionSort, moveSectionCard, moveSectionSort, renderSectionTimeSettings, saveSectionTimes, sectionSort } from './sections.js';
import { cancelSpeedSession, showSpeedNextStep, showSpeedPreviousStep } from './speed.js';
import { applySettings, cancelTrainingMetaDialog, exportData, exportRecordsCsv, handleGlobalShortcut, renderDataManagementSummary, renderStats } from './stats.js';
import { confirmFinish, recordLap, renderPresets, requestFinish, resetTimer, saveQuantitySession, setMode, startOrPause, tick, undoLap } from './timer.js';
import { closeDrawers, resetFinishDialog, showToast, stopInterval } from './ui.js';

$$('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$('#startBtn').addEventListener('click', startOrPause); $('#resetBtn').addEventListener('click', () => resetTimer(true)); $('#finishBtn').addEventListener('click', requestFinish);
$('#lapBtn').addEventListener('click', recordLap); $('#undoLapBtn').addEventListener('click', undoLap); $('#timerDisplay').addEventListener('click', recordLap);
$('#timerDisplay').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); recordLap(); } });
document.addEventListener('keydown', handleGlobalShortcut);
document.addEventListener('visibilitychange', () => {
  if (state.status === 'running') tick();
});
$('#confirmFinishBtn').addEventListener('click', confirmFinish);
$('#cancelFinishBtn').addEventListener('click', () => { state.pendingTimed = null; $('#finishDialog').close(); resetFinishDialog(); render(); syncNativeVideoTime(true); });
$$('#quantityChoiceWrap [data-quantity]').forEach(button => button.addEventListener('click', () => saveQuantitySession(Number(button.dataset.quantity))));
$('#cancelSingleModuleBtn').addEventListener('click', cancelSpeedSession);
$('#previousSpeedStepBtn').addEventListener('click', showSpeedPreviousStep);
$('#nextSpeedStepBtn').addEventListener('click', showSpeedNextStep);
$('#singleModuleDialog').addEventListener('cancel', event => { event.preventDefault(); cancelSpeedSession(); });
$$('#difficultyChoices [data-difficulty]').forEach(button => button.addEventListener('click', () => {
  const willSelect = button.getAttribute('aria-pressed') !== 'true';
  $$('#difficultyChoices [data-difficulty]').forEach(item => { item.classList.remove('selected'); item.setAttribute('aria-pressed', 'false'); });
  if (willSelect) { button.classList.add('selected'); button.setAttribute('aria-pressed', 'true'); }
}));
$$('#editRecordDifficultyChoices [data-difficulty]').forEach(button => button.addEventListener('click', () => {
  const willSelect = button.getAttribute('aria-pressed') !== 'true';
  setDifficultyChoice('editRecordDifficultyChoices', willSelect ? button.dataset.difficulty : null);
}));
$('#backTrainingMetaBtn').addEventListener('click', returnToTrainingPreviousStep); $('#skipTrainingMetaBtn').addEventListener('click', () => finishTrainingMeta(true)); $('#confirmTrainingMetaBtn').addEventListener('click', () => finishTrainingMeta(false));
  $('#recordEditForm').addEventListener('submit', event => { event.preventDefault(); saveRecordEditor(); });
  $('#cancelRecordEditBtn').addEventListener('click', closeRecordEditor);
  $('#recordEditDialog').addEventListener('cancel', event => { event.preventDefault(); closeRecordEditor(); });
  $('#addRecordBtn').addEventListener('click', openRecordCreator);
  $('#recordCreateForm').addEventListener('submit', event => { event.preventDefault(); saveRecordCreator(); });
  $('#cancelRecordCreateBtn').addEventListener('click', closeRecordCreator);
  $('#recordCreateDialog').addEventListener('cancel', event => { event.preventDefault(); closeRecordCreator(); });
  $$('#createRecordDifficultyChoices [data-difficulty]').forEach(button => button.addEventListener('click', () => {
    const willSelect = button.getAttribute('aria-pressed') !== 'true';
    setDifficultyChoice('createRecordDifficultyChoices', willSelect ? button.dataset.difficulty : null);
  }));
$('#skipMockModuleBtn').addEventListener('click', () => finishMockModuleReview(true)); $('#saveMockModuleBtn').addEventListener('click', () => finishMockModuleReview(false));
$('#backMockModuleBtn').addEventListener('click', returnFromMockModuleReview);
$('#mockModuleDialog').addEventListener('cancel', event => { event.preventDefault(); returnFromMockModuleReview(); });
$('#closeMockReportBtn').addEventListener('click', () => $('#mockReportDialog').close());
$('#editMockReportBtn').addEventListener('click', () => editMockReport($('#editMockReportBtn').dataset.mockReportId));
$('#openReportLapReviewBtn').addEventListener('click', () => openReportLapReview($('#openReportLapReviewBtn').dataset.lapId));
$('#trainingMetaDialog').addEventListener('cancel', event => { event.preventDefault(); cancelTrainingMetaDialog(); });
$('#lapDetailList').addEventListener('click', updateLapReviewFromClick); $('#lapDetailList').addEventListener('input', updateLapReviewNote);
$('#saveLapReviewBtn').addEventListener('click', saveLapReviews); $('#closeLapDetailBtn').addEventListener('click', closeLapDetail);
$('#lapDetailDialog').addEventListener('cancel', event => { event.preventDefault(); closeLapDetail(); });
$('#statsBtn').addEventListener('click', openStatsDrawer);$('#settingsBtn').addEventListener('click',()=>openSettingsDrawer());$('#backdrop').addEventListener('click',closeDrawers);$$('.close-drawer').forEach(b=>b.addEventListener('click',closeDrawers));
$('#clearAllBtn').addEventListener('click',()=>{if(state.records.length&&confirm('确定清空全部训练记录吗？此操作无法撤销。')){const previousRecords=state.records;state.records=[];if(!saveRecords()){state.records=previousRecords;return;}renderStats();}});
$('#historyFilter').addEventListener('change', renderStats);
$('#historyList').addEventListener('click', openRecordFromHistoryEvent);
$('#historyList').addEventListener('keydown', openRecordFromHistoryKey);
$$('[data-analytics-days]').forEach(button => button.addEventListener('click', () => { state.analyticsDays = Number(button.dataset.analyticsDays); renderStats(); }));
$$('[data-trend-metric]').forEach(button => button.addEventListener('click', () => { state.trendMetric = button.dataset.trendMetric; renderStats(); }));
$$('[data-trend-visual]').forEach(button => button.addEventListener('click', () => { state.trendVisual = button.dataset.trendVisual; renderStats(); }));
$$('[data-stats-view]').forEach(button => button.addEventListener('click', () => setStatsView(button.dataset.statsView)));
$$('[data-settings-view]').forEach(button => button.addEventListener('click', () => setSettingsView(button.dataset.settingsView)));
$('#soundToggle').addEventListener('change',e=>{state.settings.sound=e.target.checked;if(!e.target.checked)stopAlertKeepAlive();saveSettings()});$('#warmupSoundBtn').addEventListener('click',warmUpAlertSound);$('#focusSoundToggle').addEventListener('change',e=>toggleFocusSound(e.target.checked));$$('[data-focus-sound]').forEach(button=>button.addEventListener('click',()=>setFocusSoundType(button.dataset.focusSound)));$('#focusSoundVolume').addEventListener('input',e=>setFocusSoundVolume(+e.target.value));$('#pacingToggle').addEventListener('change',e=>{state.settings.pacing=e.target.checked;state.pacingNotified=[];saveSettings();render()});$('#shortcutsToggle').addEventListener('change',e=>{state.settings.shortcuts=e.target.checked;applySettings();if(saveSettings())showToast(e.target.checked?'全局快捷键已开启':'全局快捷键已关闭')});$('#themeToggle').addEventListener('change',e=>{state.settings.dark=e.target.checked;applySettings();saveSettings()});
$('#fontSizeRange').addEventListener('input',e=>{state.settings.fontSize=+e.target.value;applySettings();saveSettings()});$('#warningRange').addEventListener('input',e=>{state.settings.warning=+e.target.value;applySettings();saveSettings();render()});
$('#examCountdownOpenBtn').addEventListener('click', openExamCountdownSettings); $('#examCheckinBtn').addEventListener('click', checkInExamCountdown);
$('#saveExamCountdownBtn').addEventListener('click', saveExamCountdownSettings); $('#settingsExamCheckinBtn').addEventListener('click', checkInExamCountdown);
$('#saveSectionTimesBtn').addEventListener('click', saveSectionTimes);
$('#sectionTimeGrid').addEventListener('click', event => { const button = event.target.closest('[data-move-section]'); if (button) moveSectionCard(button); });
$('#sectionTimeGrid').addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' || event.button !== 0 || event.target.closest('input,button,a')) return;
  const card = event.target.closest('[data-section-card]'); if (card) beginSectionSort(card, event.clientX, event.clientY, 'pointer', event.pointerId);
});
document.addEventListener('pointermove', event => { if (sectionSort.inputType === 'pointer' && event.pointerId === sectionSort.pointerId) moveSectionSort(event.clientX, event.clientY, event); });
document.addEventListener('pointerup', event => { if (sectionSort.inputType === 'pointer' && event.pointerId === sectionSort.pointerId) finishSectionSort(false); });
document.addEventListener('pointercancel', event => { if (sectionSort.inputType === 'pointer' && event.pointerId === sectionSort.pointerId) finishSectionSort(true); });
$('#sectionTimeGrid').addEventListener('touchstart', event => {
  if (event.touches.length !== 1 || event.target.closest('input,button,a')) return;
  const card = event.target.closest('[data-section-card]'), touch = event.touches[0]; if (card) beginSectionSort(card, touch.clientX, touch.clientY, 'touch', touch.identifier);
}, { passive: true });
document.addEventListener('touchmove', event => {
  if (sectionSort.inputType !== 'touch') return;
  const touch = [...event.touches].find(item => item.identifier === sectionSort.touchId); if (touch) moveSectionSort(touch.clientX, touch.clientY, event);
}, { passive: false });
document.addEventListener('touchend', event => { if (sectionSort.inputType === 'touch' && [...event.changedTouches].some(item => item.identifier === sectionSort.touchId)) finishSectionSort(false); });
document.addEventListener('touchcancel', event => { if (sectionSort.inputType === 'touch' && [...event.changedTouches].some(item => item.identifier === sectionSort.touchId)) finishSectionSort(true); });
document.addEventListener('contextmenu', event => { if (sectionSort.card || event.target.closest('[data-section-card]')) event.preventDefault(); });
$('#sectionTimeGrid').addEventListener('dragstart', event => event.preventDefault());
$('#exportDataBtn').addEventListener('click', exportData); $('#exportCsvBtn').addEventListener('click', exportRecordsCsv); $('#importDataBtn').addEventListener('click', () => $('#importDataInput').click()); $('#importDataInput').addEventListener('change', e => { importDataFile(e.target.files[0]); e.target.value = ''; });
$('#cancelRestoreBtn').addEventListener('click', cancelRestoreImport); $('#confirmMergeRestoreBtn').addEventListener('click', () => confirmRestoreImport('merge')); $('#confirmRestoreBtn').addEventListener('click', () => confirmRestoreImport('replace'));
$('#pipBtn').addEventListener('click',togglePip);
pipVideo.addEventListener('leavepictureinpicture', stopPipFrames);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]') && $('.drawer.open')) closeDrawers(); });
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(error => console.warn('Service Worker 注册失败', error)));
}
document.addEventListener('pointerdown', maybeResumeFocusSound, { passive: true });
document.addEventListener('keydown', maybeResumeFocusSound);
window.addEventListener('beforeunload', () => { if (state.status === 'running') tick(true); persistActiveSession(true); stopInterval(); stopMobilePipSyncLoop(); stopPipFrames(); stopFocusSound(false); });
applyCustomDurations();
const recoveredActiveSession = restoreActiveSession();
applySettings(); renderSectionTimeSettings(); renderPresets(); renderStats(); renderDataManagementSummary(); render();
applyLaunchShortcut(recoveredActiveSession);
if (recoveredActiveSession) setTimeout(() => showToast('已恢复上次未完成的训练，当前处于暂停状态'), 120);

export {};
