/**
 * Coverage scored from the session, not from English.
 *
 * `TOPIC_KEYWORDS` was the entire scorer, and it is English-only: `grew up`,
 * `unpopular`, `won't`, `expert`. Two answers that plainly cover a topic scored
 * zero on it forever:
 *   - a Values interview answered in Czech;
 *   - an Expertise answer that never happens to say "expert".
 *
 * Both are the two cases below. The predicate the user reads is "memories from
 * a session about this topic", so that is what the score has to count when it
 * knows it, with keywords kept only for rows no session tagged.
 */
import { describe, it, expect } from 'vitest';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';

import {
  scoreTopicCoverage,
  topicByCommunication,
  trainingQaFacts,
  readTaggedTopic,
  TRAINING_QA_KIND,
} from '../topicCoverage';

function mem(over: Partial<TwinPendingMemory>): TwinPendingMemory {
  return {
    id: 'm1',
    twin_id: 't1',
    channel: 'training',
    content: '',
    title: null,
    importance: 3,
    status: 'approved',
    reviewer_notes: null,
    source_communication_id: null,
    created_at: '2026-09-01T00:00:00Z',
    reviewed_at: null,
    ...over,
  };
}

function comm(id: string, keyFacts: string | null): Pick<TwinCommunication, 'id' | 'key_facts_json'> {
  return { id, key_facts_json: keyFacts };
}

const countOf = (rows: ReturnType<typeof scoreTopicCoverage>, id: string) =>
  rows.find((r) => r.id === id)!;

describe('trainingQaFacts / readTaggedTopic', () => {
  it('round-trips a preset and keeps the pairs', () => {
    const json = trainingQaFacts([{ q: 'Q', a: 'A' }], 'values');
    expect(readTaggedTopic(json)).toBe('values');
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe(TRAINING_QA_KIND);
    expect(parsed.pairs).toEqual([{ q: 'Q', a: 'A' }]);
  });

  it('an untagged save keeps the legacy bare-array shape', () => {
    const json = trainingQaFacts([{ q: 'Q', a: 'A' }], null);
    expect(JSON.parse(json)).toEqual([{ q: 'Q', a: 'A' }]);
    expect(readTaggedTopic(json)).toBeNull();
  });

  it('refuses anything that is not a tag it wrote', () => {
    expect(readTaggedTopic(null)).toBeNull();
    expect(readTaggedTopic('not json')).toBeNull();
    expect(readTaggedTopic('[{"q":"x","a":"y"}]')).toBeNull();
    expect(readTaggedTopic('{"kind":"session_summary","qa_count":4}')).toBeNull();
    // An id no preset answers to must not create a seventh bucket.
    expect(readTaggedTopic(`{"kind":"${TRAINING_QA_KIND}","topic":"astrology"}`)).toBeNull();
  });
});

describe('scoreTopicCoverage', () => {
  it('a Czech values answer with no English keyword counts for Values', () => {
    const memories = [mem({ id: 'm1', source_communication_id: 'c1', content: 'Důležitá je rodina' })];
    const tags = topicByCommunication([comm('c1', trainingQaFacts([{ q: 'Q', a: 'A' }], 'values'))]);

    // The old scorer: zero, forever.
    expect(countOf(scoreTopicCoverage(memories), 'values').count).toBe(0);
    expect(countOf(scoreTopicCoverage(memories), 'values').tier).toBe('thin');

    const scored = countOf(scoreTopicCoverage(memories, tags), 'values');
    expect(scored.count).toBe(1);
  });

  it('an expertise answer that never says "expert" still counts for Expertise', () => {
    const memories = [
      mem({ id: 'm1', source_communication_id: 'c1', content: 'I mostly build compilers and debuggers.' }),
    ];
    const tags = topicByCommunication([comm('c1', trainingQaFacts([{ q: 'Q', a: 'A' }], 'expertise'))]);

    expect(countOf(scoreTopicCoverage(memories), 'expertise').count).toBe(0);
    expect(countOf(scoreTopicCoverage(memories, tags), 'expertise').count).toBe(1);
  });

  it('a tagged memory counts for its preset ONLY, not for every keyword it trips', () => {
    // This text hits `opinions` ("think"), `values` ("important") and
    // `personal` ("family") under the keyword scorer.
    const memories = [
      mem({
        id: 'm1',
        source_communication_id: 'c1',
        content: 'I think family is the most important thing',
      }),
    ];
    const untagged = scoreTopicCoverage(memories);
    expect(untagged.filter((r) => r.count > 0).length).toBeGreaterThan(1);

    const tags = topicByCommunication([comm('c1', trainingQaFacts([{ q: 'Q', a: 'A' }], 'values'))]);
    const tagged = scoreTopicCoverage(memories, tags);
    expect(tagged.filter((r) => r.count > 0).map((r) => r.id)).toEqual(['values']);
  });

  it('untagged legacy rows still score by keyword, alongside tagged ones', () => {
    const memories = [
      mem({ id: 'm1', source_communication_id: 'c1', content: 'Důležitá je rodina' }),
      // No source communication at all (URL ingest, wiki audit) — keyword path.
      mem({ id: 'm2', content: 'My unpopular opinion about frameworks' }),
      // Has a source, but that session carried no tag — keyword path.
      mem({ id: 'm3', source_communication_id: 'c-legacy', content: 'my first job was at a bank' }),
    ];
    const tags = topicByCommunication([
      comm('c1', trainingQaFacts([{ q: 'Q', a: 'A' }], 'values')),
      comm('c-legacy', '[{"q":"old","a":"row"}]'),
    ]);
    const scored = scoreTopicCoverage(memories, tags);

    expect(countOf(scored, 'values').count).toBe(1);
    expect(countOf(scored, 'opinions').count).toBe(1);
    expect(countOf(scored, 'background').count).toBe(1);
  });

  it('tiers still ladder off the combined count', () => {
    const memories = Array.from({ length: 5 }, (_, i) =>
      mem({ id: `m${i}`, source_communication_id: `c${i}`, content: 'anything at all' }),
    );
    const tags = topicByCommunication(
      memories.map((m, i) => comm(`c${i}`, trainingQaFacts([{ q: 'Q', a: 'A' }], 'personal'))),
    );
    const scored = scoreTopicCoverage(memories, tags);
    expect(countOf(scored, 'personal')).toMatchObject({ count: 5, tier: 'covered' });
    expect(countOf(scored, 'values')).toMatchObject({ count: 0, tier: 'thin' });
  });

  it('every preset is always present, scored or not', () => {
    expect(scoreTopicCoverage([]).map((r) => r.id)).toEqual([
      'background',
      'opinions',
      'communication',
      'values',
      'expertise',
      'personal',
    ]);
  });
});
