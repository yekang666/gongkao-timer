import { normalizeLapReviews, normalizeLaps, toNonNegativeInt, toPositiveInt, toScore } from './core.js';

function hasAccuracy(record) {
  return toPositiveInt(record.questions) && toNonNegativeInt(record.correct) !== null;
}

function getAccuracyTotals(records) {
  return records.filter(hasAccuracy).reduce((totals, record) => {
    totals.questions += toPositiveInt(record.questions);
    totals.correct += toNonNegativeInt(record.correct);
    return totals;
  }, { questions: 0, correct: 0 });
}

function getScoreAverage(records) {
  const scores = records.map(record => toScore(record.score)).filter(Number.isFinite);
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
}

function getLapReviewCounts(reviews, lapCount) {
  const counts = { correct: 0, wrong: 0, skipped: 0, reviewed: 0, reasons: {} };
  const normalized = normalizeLapReviews(reviews, lapCount);
  for (let index = 0; index < lapCount; index += 1) {
    const review = normalized[index];
    if (!review?.status) continue;
    counts[review.status] += 1;
    counts.reviewed += 1;
    if (review.status === 'wrong' && review.reason) counts.reasons[review.reason] = (counts.reasons[review.reason] || 0) + 1;
  }
  return counts;
}

function getLapStats(laps) {
  const values = normalizeLaps(laps);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const slowest = Math.max(...values);
  const fastest = Math.min(...values);
  return { values, total, average: total / values.length, median, slowest, fastest, slowestIndex: values.indexOf(slowest) };
}

export { getAccuracyTotals, getLapReviewCounts, getLapStats, getScoreAverage, hasAccuracy };
