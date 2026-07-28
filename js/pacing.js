import { MOCK_PACING_QUESTION_COUNTS, state } from './core.js';
import { getOrderedSectionPresets } from './sections.js';

function isMockPacingActive() {
  return state.settings.pacing !== false && state.mode === 'mock' && state.preset.name === '行测模考';
}

function getMockPacingPlan() {
  const pacingPresets = getOrderedSectionPresets();
  const configuredTotal = pacingPresets.reduce((sum, preset) => sum + preset.seconds, 0);
  if (!configuredTotal || state.duration <= 0) return [];
  let configuredElapsed = 0;
  let questionTotal = 0;
  return pacingPresets.map((preset, index) => {
    configuredElapsed += preset.seconds;
    questionTotal += MOCK_PACING_QUESTION_COUNTS[preset.name] || 0;
    return {
      index,
      module: preset.name,
      at: state.duration * configuredElapsed / configuredTotal,
      questions: questionTotal,
      nextModule: pacingPresets[index + 1]?.name || null
    };
  }).slice(0, -1);
}

export { getMockPacingPlan, isMockPacingActive };
