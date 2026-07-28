const APP_EVENTS = Object.freeze({
  EXPORT_DATA: 'backup:export-data',
  FINISH_SPEED: 'workflow:finish-speed',
  OPEN_MOCK_REVIEW: 'workflow:open-mock-review',
  OPEN_TIMED_META: 'workflow:open-timed-meta',
  OPEN_TRAINING_META: 'workflow:open-training-meta',
  RENDER_APP: 'render:app',
  RENDER_PRESETS: 'render:presets',
  RENDER_STATS: 'render:stats',
  RESUME_FOCUS_SOUND: 'audio:resume-focus-sound',
  SHORTCUT_ACTION: 'shortcut:action',
  STORAGE_ERROR: 'storage:error'
});

const listeners = new Map();

function onAppEvent(type, listener) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(listener);
  return () => listeners.get(type)?.delete(listener);
}

function emitAppEvent(type, detail) {
  listeners.get(type)?.forEach(listener => listener(detail));
}

export { APP_EVENTS, emitAppEvent, onAppEvent };
