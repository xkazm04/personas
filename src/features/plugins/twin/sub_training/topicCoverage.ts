import { TRAINING_TOPIC_PRESETS } from './useTrainingSession';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';

/**
 * Topic-coverage scoring shared by NextMovesPanel (the post-session "where
 * to go next" recommendation) and the TrainingAtelier topic deck (a coverage
 * pill on each preset card, so the user sees which areas are thin BEFORE
 * picking — not just after a session finishes).
 *
 * Coverage is a rough keyword match of each preset against the active twin's
 * approved memories. It's intentionally cheap and approximate — a directional
 * "you've barely touched Values" signal, not an exact tally.
 */

export type PresetId = (typeof TRAINING_TOPIC_PRESETS)[number]['id'];

export const TOPIC_KEYWORDS: Record<string, string[]> = {
  background: ['background', 'history', 'experience', 'started', 'began', 'career', 'grew up', 'where you', 'how did you', 'first job'],
  opinions: ['opinion', 'think', 'believe', 'view', 'stance', 'agree', 'disagree', 'should', 'controversial', 'unpopular'],
  communication: ['communication', 'voice', 'tone', 'style', 'write', 'speak', 'audience', 'phrase', 'word'],
  values: ['value', 'principle', 'matter', 'important', 'priority', 'won\'t', 'never', 'always', 'integrity'],
  expertise: ['expert', 'specialty', 'skill', 'domain', 'knowledge', 'deep', 'unique', 'advice'],
  personal: ['personal', 'hobby', 'interest', 'enjoy', 'favorite', 'love', 'weekend', 'family', 'home'],
};

export type CoverageTier = 'thin' | 'some' | 'covered';

export interface TopicCoverage {
  id: PresetId;
  count: number;
  tier: CoverageTier;
}

/** ≥ this many matched memories → "well covered". */
export const COVERAGE_COVERED_THRESHOLD = 5;
/** ≥ this many (but below covered) → "some coverage"; below → "thin". */
export const COVERAGE_SOME_THRESHOLD = 2;

export function tierForCount(count: number): CoverageTier {
  if (count >= COVERAGE_COVERED_THRESHOLD) return 'covered';
  if (count >= COVERAGE_SOME_THRESHOLD) return 'some';
  return 'thin';
}

/** Count keyword-matched texts per preset, with a derived tier. The generic
 *  form also scores a session's own saved Q&A (TrainingAtelier's certificate
 *  impact recap), not just persisted memories. */
export function scoreTopicTexts(texts: string[]): TopicCoverage[] {
  return TRAINING_TOPIC_PRESETS.map((preset) => {
    const kws = TOPIC_KEYWORDS[preset.id] ?? [];
    let count = 0;
    for (const text of texts) {
      const hay = text.toLowerCase();
      if (kws.some((kw) => hay.includes(kw))) count += 1;
    }
    return { id: preset.id, count, tier: tierForCount(count) };
  });
}

/** Count keyword-matched approved memories per preset, with a derived tier. */
export function scoreTopicCoverage(memories: TwinPendingMemory[]): TopicCoverage[] {
  return scoreTopicTexts(memories.map((m) => `${m.title ?? ''} ${m.content}`));
}
