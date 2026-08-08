import { openSettingsDrawer, openStatsDrawer, setSettingsView, setStatsView } from './analytics.js';
import { APP_EVENTS, onAppEvent } from './app-events.js';
import { maybeResumeFocusSound, setFocusSoundType, setFocusSoundVolume, stopAlertKeepAlive, stopFocusSound, toggleFocusSound, warmUpAlertSound } from './audio.js';
import { cancelRestoreImport, confirmRestoreImport, importDataFile } from './backup.js';
import { applyLaunchShortcut } from './launch.js';
import { $, $$, persistActiveSession, restoreActiveSession, saveRecords, saveSettings, state } from './core.js';
import { checkInExamCountdown, openExamCountdownSettings, saveExamCountdownSettings } from './exam.js';
import { beginTimedMeta, editMockReport, finishMockModuleReview, finishTrainingMeta, openMockModuleReview, openMockReport, openReportLapReview, openTrainingMetaDialog, returnFromMockModuleReview, returnToTrainingPreviousStep } from './mock.js';
import { pipVideo, stopMobilePipSyncLoop, stopPipFrames, syncNativeVideoTime, togglePip } from './pip.js';
import { closeRecordCreator, closeRecordEditor, openRecordCreator, openRecordFromHistoryEvent, openRecordFromHistoryKey, saveRecordCreator, saveRecordEditor, setDifficultyChoice } from './records.js';
import { closeLapDetail, render, saveLapReviews, updateLapReviewFromClick, updateLapReviewNote } from './render.js';
import { addPacingPreset, applyCustomDurations, movePacingPreset, removePacingPreset, renderSectionTimeSettings, saveSectionTimes, setPacingGroup } from './sections.js';
import { cancelSpeedSession, finishSpeedSession, showSpeedNextStep, showSpeedPreviousStep } from './speed.js';
import { applySettings, exportData, exportRecordsCsv, handleGlobalShortcut, renderDataManagementSummary, renderStats } from './stats.js';
import { confirmFinish, recordLap, renderPresets, requestFinish, resetTimer, saveQuantitySession, setMode, setSectionGroup, startOrPause, tick, undoLap } from './timer.js';
import { appConfirm, closeDrawers, resetFinishDialog, showToast, stopInterval } from './ui.js';

function runShortcutAction(action) {
  const actions = {
    toggle: startOrPause,
    finish: requestFinish,
    reset: () => resetTimer(true),
    lap: recordLap,
    undoLap,
    stats: openStatsDrawer,
    settings: () => openSettingsDrawer(),
    shortcutHelp: () => openSettingsDrawer('shortcuts')
  };
  actions[action]?.();
}

function parseStatsPeriod(value) {
  return value === 'all' ? 'all' : Number(value);
}

function cancelTrainingMetaDialog() {
  if (state.pendingMeta?.previous) { returnToTrainingPreviousStep(); return; }
  state.pendingMeta = null;
  $('#trainingMetaDialog').close();
  render();
  showToast('已返回计时，当前训练尚未保存');
}

onAppEvent(APP_EVENTS.EXPORT_DATA, exportData);
onAppEvent(APP_EVENTS.FINISH_SPEED, finishSpeedSession);
onAppEvent(APP_EVENTS.OPEN_MOCK_REVIEW, ({ result, options = {} }) => openMockModuleReview(result, options));
onAppEvent(APP_EVENTS.OPEN_TIMED_META, ({ result, previous = null }) => beginTimedMeta(result, previous));
onAppEvent(APP_EVENTS.OPEN_TRAINING_META, ({ title, initialMeta = null, showBack = false }) => openTrainingMetaDialog(title, initialMeta, showBack));
onAppEvent(APP_EVENTS.RENDER_APP, options => options?.resetTimer ? resetTimer(false) : render());
onAppEvent(APP_EVENTS.RENDER_PRESETS, renderPresets);
onAppEvent(APP_EVENTS.RENDER_STATS, renderStats);
onAppEvent(APP_EVENTS.RESUME_FOCUS_SOUND, maybeResumeFocusSound);
onAppEvent(APP_EVENTS.SHORTCUT_ACTION, runShortcutAction);
onAppEvent(APP_EVENTS.STORAGE_ERROR, message => showToast(message));

$$('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
$$('[data-section-group]').forEach(button => button.addEventListener('click', () => setSectionGroup(button.dataset.sectionGroup)));
$('#startBtn').addEventListener('click', startOrPause); $('#resetBtn').addEventListener('click', () => resetTimer(true)); $('#finishBtn').addEventListener('click', requestFinish);
$('#lapBtn').addEventListener('click', recordLap); $('#undoLapBtn').addEventListener('click', undoLap); $('#timerDisplay').addEventListener('click', recordLap);
$('#timerDisplay').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); recordLap(); } });
document.addEventListener('keydown', handleGlobalShortcut);
// iOS 不可靠触发 beforeunload：切后台 / 页面隐藏 / pagehide 时强制保存训练现场
function persistBeforeLeave() { if (state.status === 'running') tick(true); persistActiveSession(true); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { persistBeforeLeave(); return; }
  if (state.status === 'running') tick();
});
window.addEventListener('pagehide', persistBeforeLeave);
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
$('#clearAllBtn').addEventListener('click',()=>{if(state.records.length&&appConfirm('确定清空全部训练记录吗？此操作无法撤销。')){const previousRecords=state.records;state.records=[];if(!saveRecords()){state.records=previousRecords;return;}renderStats();}});
$('#historyFilter').addEventListener('change', () => { state.historyPage = 1; renderStats(); });
$('#historyModuleFilter').addEventListener('change', () => { state.historyPage = 1; renderStats(); });
$('#historyList').addEventListener('click', event => {
  const mockReport = event.target.closest('[data-mock-report-id]');
  if (mockReport) { openMockReport(mockReport.dataset.mockReportId); return; }
  const lapDetail = event.target.closest('[data-lap-id]');
  if (lapDetail) { openLapDetail(lapDetail.dataset.lapId); return; }
  openRecordFromHistoryEvent(event);
});
$('#historyList').addEventListener('keydown', openRecordFromHistoryKey);
$$('[data-trend-period]').forEach(button => button.addEventListener('click', () => { state.trendPeriod = parseStatsPeriod(button.dataset.trendPeriod); renderStats(); }));
$$('[data-baseline-period]').forEach(button => button.addEventListener('click', () => { state.baselinePeriod = parseStatsPeriod(button.dataset.baselinePeriod); renderStats(); }));
$$('[data-history-period]').forEach(button => button.addEventListener('click', () => { state.historyPeriod = parseStatsPeriod(button.dataset.historyPeriod); state.historyPage = 1; renderStats(); }));
$('#historyPrevBtn').addEventListener('click', () => { state.historyPage = Math.max(1, state.historyPage - 1); renderStats(); });
$('#historyNextBtn').addEventListener('click', () => { state.historyPage += 1; renderStats(); });
$$('[data-trend-metric]').forEach(button => button.addEventListener('click', () => { state.trendMetric = button.dataset.trendMetric; renderStats(); }));
$$('[data-trend-visual]').forEach(button => button.addEventListener('click', () => { state.trendVisual = button.dataset.trendVisual; renderStats(); }));
$$('[data-stats-view]').forEach(button => button.addEventListener('click', () => setStatsView(button.dataset.statsView)));
$$('[data-settings-view]').forEach(button => button.addEventListener('click', () => setSettingsView(button.dataset.settingsView)));
$('#soundToggle').addEventListener('change',e=>{state.settings.sound=e.target.checked;if(!e.target.checked)stopAlertKeepAlive();saveSettings()});$('#warmupSoundBtn').addEventListener('click',warmUpAlertSound);$('#focusSoundToggle').addEventListener('change',e=>toggleFocusSound(e.target.checked));$$('[data-focus-sound]').forEach(button=>button.addEventListener('click',()=>setFocusSoundType(button.dataset.focusSound)));$('#focusSoundVolume').addEventListener('input',e=>setFocusSoundVolume(+e.target.value));$('#pacingToggle').addEventListener('change',e=>{state.settings.pacing=e.target.checked;state.pacingNotified=[];saveSettings();render()});$('#shortcutsToggle').addEventListener('change',e=>{state.settings.shortcuts=e.target.checked;applySettings();if(saveSettings())showToast(e.target.checked?'全局快捷键已开启':'全局快捷键已关闭')});$('#themeToggle').addEventListener('change',e=>{state.settings.dark=e.target.checked;applySettings();saveSettings()});
$('#fontSizeRange').addEventListener('input',e=>{state.settings.fontSize=+e.target.value;applySettings();saveSettings()});$('#warningRange').addEventListener('input',e=>{state.settings.warning=+e.target.value;applySettings();saveSettings();render()});
$('#examCountdownOpenBtn').addEventListener('click', openExamCountdownSettings); $('#examCheckinBtn').addEventListener('click', checkInExamCountdown);
$('#saveExamCountdownBtn').addEventListener('click', saveExamCountdownSettings); $('#settingsExamCheckinBtn').addEventListener('click', checkInExamCountdown);
$('#saveSectionTimesBtn').addEventListener('click', saveSectionTimes);
$('#pacingGroupSwitch').addEventListener('click', event => { const button = event.target.closest('[data-pacing-group]'); if (button) setPacingGroup(button.dataset.pacingGroup); });
$('#sectionTimeGrid').addEventListener('click', event => { const button = event.target.closest('[data-pacing-add]'); if (button) addPacingPreset(button.dataset.pacingName); });
$('#pacingPlanList').addEventListener('click', event => {
  const remove = event.target.closest('[data-pacing-remove]'); if (remove) { removePacingPreset(remove.dataset.pacingName); return; }
  const move = event.target.closest('[data-pacing-move]'); if (move) movePacingPreset(move.dataset.pacingName, move.dataset.pacingMove);
});
$('#exportDataBtn').addEventListener('click', exportData); $('#exportCsvBtn').addEventListener('click', exportRecordsCsv); $('#importDataBtn').addEventListener('click', () => $('#importDataInput').click()); $('#importDataInput').addEventListener('change', e => { importDataFile(e.target.files[0]); e.target.value = ''; });
$('#cancelRestoreBtn').addEventListener('click', cancelRestoreImport); $('#confirmMergeRestoreBtn').addEventListener('click', () => confirmRestoreImport('merge')); $('#confirmRestoreBtn').addEventListener('click', () => confirmRestoreImport('replace'));
$('#pipBtn').addEventListener('click',togglePip);
pipVideo.addEventListener('leavepictureinpicture', stopPipFrames);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]') && $('.drawer.open')) closeDrawers(); });
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(error => console.warn('Service Worker 注册失败', error)));
}
document.addEventListener('pointerdown', maybeResumeFocusSound, { passive: true });
window.addEventListener('focus', maybeResumeFocusSound);
document.addEventListener('keydown', maybeResumeFocusSound);
window.addEventListener('beforeunload', () => { if (state.status === 'running') tick(true); persistActiveSession(true); stopInterval(); stopMobilePipSyncLoop(); stopPipFrames(); stopFocusSound(false); });
applyCustomDurations();
const recoveredActiveSession = restoreActiveSession();
applySettings(); renderSectionTimeSettings(); renderPresets(); renderStats(); renderDataManagementSummary(); render();
applyLaunchShortcut(recoveredActiveSession);
if (recoveredActiveSession) setTimeout(() => showToast('已恢复上次未完成的训练，当前处于暂停状态'), 120);

export {};
