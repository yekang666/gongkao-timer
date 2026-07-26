import { getDateStamp } from './stats.js';

function formatClock(total) {
  total = Math.max(0, Math.round(total));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}
function formatShortClock(total) { const clock = formatClock(total); return total >= 3600 ? clock : clock.slice(3); }
function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
function formatAccuracy(correct, questions) {
  if (!Number.isFinite(correct) || !questions) return '暂无';
  const rate = (correct / questions) * 100;
  const rounded = Math.round(rate * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}
function formatScore(score) {
  if (!Number.isFinite(score)) return '暂无';
  return `${Number.isInteger(score) ? score : score.toFixed(1)} 分`;
}
function parseDateKey(key) {
  const match = typeof key === 'string' ? key.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
function getTodayKey() { return getDateStamp(new Date()); }

export { formatAccuracy, formatClock, formatDuration, formatScore, formatShortClock, getTodayKey, parseDateKey };
