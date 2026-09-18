import { TRAINING_TOPIC_PRESETS } from './useTrainingSession';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';

/**
 * Topic-coverage scoring shared by NextMovesPanel (the post-session "where
 * to go next" recommendation) and the TrainingAtelier topic deck (a coverage
 * pill on each preset card, so the user sees which areas are thin BEFORE
 * picking — not just after a session finishes).
 *
 * Coverage is scored from the PRESET a session was actually run under, and
 * falls back to a keyword match only for memories no session tagged.
 *
 * The keyword table below was the whole scorer until this change, and it is
 * English-only: `grew up`, `unpopular`, `won't`. A values interview answered in
 * Czech scored zero on Values forever, and an expertise answer that never
 * happened to say "expert" scored zero on Expertise. The predicate the user is
 * reading is "memories from a session about this topic", so that is what the
 * score counts when it can (`baseline-ladder`: a score has to be ASKED against
 * something).
 *
 * Tagging is frontend-only and needs no schema: a training pair is saved as a
 * communication whose `key_facts_json` is free-text, and a pending memory
 * carries `source_communication_id` back to it. Nothing in Rust parses that
 * column - it is an opaque passthrough - so the tag rides along inside it.
 */

import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';

export type PresetId = (typeof TRAINING_TOPIC_PRESETS)[number]['id'];

/** `key_facts_json.kind` marking a saved training question/answer pair. */
export const TRAINING_QA_KIND = 'training_qa';

/**
 * The fallback, and only the fallback. Untouched on purpose: legacy rows saved
 * before tagging existed still have to score somehow, and this is how they did.
 */
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

const PRESET_IDS = new Set<string>(TRAINING_TOPIC_PRESETS.map((p) => p.id));

/**
 * The `key_facts_json` payload for one saved training pair.
 *
 * The pairs stay in it. Earlier saves wrote a bare `[{ q, a }]` array and this
 * wraps rather than replaces that, so no information is lost and the one
 * existing reader (`useTrainingMomentum`, which greps for `session_summary`)
 * is unaffected.
 */
export function trainingQaFacts(
  pairs: { q: string; a: string }[],
  presetId: PresetId | null,
): string {
  return JSON.stringify(
    presetId ? { kind: TRAINING_QA_KIND, topic: presetId, pairs } : pairs,
  );
}

/** The preset a saved communication was run under, or null if it carries none. */
export function readTaggedTopic(keyFactsJson: string | null | undefined): PresetId | null {
  if (!keyFactsJson) return null;
  try {
    const parsed: unknown = JSON.parse(keyFactsJson);
    // The invariant: this column is written by `trainingQaFacts` above, or is a
    // legacy array, or belongs to another feature entirely. Only the first
    // shape carries a topic, and an unknown preset id is treated as untagged
    // rather than counted into a bucket that does not exist.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as { kind?: unknown; topic?: unknown };
    if (obj.kind !== TRAINING_QA_KIND) return null;
    return typeof obj.topic === 'string' && PRESET_IDS.has(obj.topic)
      ? (obj.topic as PresetId)
      : null;
  } catch {
    return null;
  }
}

/** communication id → the preset that session was run under. */
export function topicByCommunication(
  comms: Pick<TwinCommunication, 'id' | 'key_facts_json'>[],
): Map<string, PresetId> {
  const out = new Map<string, PresetId>();
  for (const c of comms) {
    const topic = readTaggedTopic(c.key_facts_json);
    if (topic) out.set(c.id, topic);
  }
  return out;
}

/** Count keyword-matched texts per preset, with a derived tier. The generic
 *  form also scores a session's own saved Q&A (the certificate impact recap),
 *  not just persisted memories. */
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

/**
 * Coverage over a twin's approved memories.
 *
 * A memory whose source session was tagged counts for THAT preset and nothing
 * else - the session is better evidence than a word that happened to appear.
 * A memory with no tag falls back to the keyword match, which can credit
 * several presets at once, exactly as it always did.
 */
export function scoreTopicCoverage(
  memories: TwinPendingMemory[],
  topicByComm?: Map<string, PresetId>,
): TopicCoverage[] {
  const tagged = new Map<PresetId, number>();
  const untaggedTexts: string[] = [];

  for (const m of memories) {
    const topic = m.source_communication_id ? topicByComm?.get(m.source_communication_id) : undefined;
    if (topic) {
      tagged.set(topic, (tagged.get(topic) ?? 0) + 1);
    } else {
      untaggedTexts.push(`${m.title ?? ''} ${m.content}`);
    }
  }

  const keyword = new Map(scoreTopicTexts(untaggedTexts).map((c) => [c.id, c.count]));
  return TRAINING_TOPIC_PRESETS.map((preset) => {
    const count = (tagged.get(preset.id) ?? 0) + (keyword.get(preset.id) ?? 0);
    return { id: preset.id, count, tier: tierForCount(count) };
  });
}
