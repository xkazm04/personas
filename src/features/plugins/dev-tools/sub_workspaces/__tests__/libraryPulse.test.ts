import { describe, expect, it } from 'vitest';

import {
  computeDigest,
  computeHealth,
  isWellFormedTopic,
  type PillarKey,
} from '../libraryPulse';
import type { KnowledgeItemView } from '../libraryModel';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';

const NOW = '2026-07-25T12:00:00.000Z';
const daysAgo = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString();

function item(over: Partial<KnowledgeItemView> = {}): KnowledgeItemView {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'pattern',
    status: 'observed',
    title: 'A practice',
    statement: 'Do the thing.',
    topic: 'data/store-boundary',
    layers: [],
    frameworks: [],
    originProjectId: null,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
    decidedAt: null,
    confidence: null,
    abstraction: 'meso',
    ftype: 'module-boundary',
    durability: 'durable',
    governingId: null,
    evidenceCount: null,
    ...over,
  };
}

const cell = (
  practice_id: string,
  state: string,
  project_id = 'p1',
): WorkspacePracticeAdoption => ({
  practice_id,
  project_id,
  state,
  fleet_key: null,
  note: null,
  last_verified_at: null,
  updated_at: NOW,
});

const score = (h: ReturnType<typeof computeHealth>, key: PillarKey) =>
  h.pillars.find((p) => p.key === key)!.score;

describe('computeDigest', () => {
  it('windows decisions on decidedAt, not updatedAt', () => {
    // A topic renormalization or a verification pass touches updatedAt on
    // months-old rows; those must not resurface as "decided this week".
    const d = computeDigest(
      [
        item({ status: 'adopted', decidedAt: daysAgo(2), updatedAt: daysAgo(2) }),
        item({ status: 'adopted', decidedAt: daysAgo(200), updatedAt: daysAgo(0) }),
      ],
      NOW,
    );
    expect(d.adopted).toHaveLength(1);
  });

  it('separates the three decision outcomes and fresh harvest', () => {
    const d = computeDigest(
      [
        item({ status: 'adopted', decidedAt: daysAgo(1) }),
        item({ status: 'rejected', decidedAt: daysAgo(3) }),
        item({ status: 'deprecated', decidedAt: daysAgo(6) }),
        item({ status: 'observed', createdAt: daysAgo(2) }),
        item({ status: 'observed', createdAt: daysAgo(40) }),
      ],
      NOW,
    );
    expect(d.adopted).toHaveLength(1);
    expect(d.rejected).toHaveLength(1);
    expect(d.deprecated).toHaveLength(1);
    expect(d.harvested).toHaveLength(1);
    // pending ignores the window — it is the whole backlog
    expect(d.pending).toHaveLength(2);
    expect(d.quiet).toBe(false);
  });

  it('respects a custom window', () => {
    const items = [item({ status: 'adopted', decidedAt: daysAgo(20) })];
    expect(computeDigest(items, NOW, 7).adopted).toHaveLength(0);
    expect(computeDigest(items, NOW, 30).adopted).toHaveLength(1);
  });

  it('reports a quiet week honestly instead of padding it', () => {
    const d = computeDigest([item({ status: 'observed', createdAt: daysAgo(90) })], NOW);
    expect(d.quiet).toBe(true);
    expect(d.pending).toHaveLength(1);
  });

  it('excludes demo rows — a digest must not count the sample corpus', () => {
    const d = computeDigest(
      [item({ status: 'adopted', decidedAt: daysAgo(1), mock: true })],
      NOW,
    );
    expect(d.adopted).toHaveLength(0);
    expect(d.quiet).toBe(true);
  });

  it('survives an unparseable timestamp', () => {
    const d = computeDigest([item({ status: 'adopted', decidedAt: 'not-a-date' })], NOW);
    expect(d.adopted).toHaveLength(0);
  });
});

describe('isWellFormedTopic', () => {
  it('requires exactly two segments and rejects the quarantine shelf', () => {
    expect(isWellFormedTopic('data/store-boundary')).toBe(true);
    expect(isWellFormedTopic('data')).toBe(false);
    expect(isWellFormedTopic('data/store-boundary/pooling')).toBe(false);
    expect(isWellFormedTopic('')).toBe(false);
    expect(isWellFormedTopic('unsorted/needs-topic')).toBe(false);
    expect(isWellFormedTopic('data/unsorted')).toBe(false);
  });
});

describe('computeHealth', () => {
  it('governance is the adjudicated share of everything', () => {
    const h = computeHealth(
      [
        item({ status: 'adopted', decidedAt: NOW }),
        item({ status: 'rejected', decidedAt: NOW }),
        item({ status: 'observed' }),
        item({ status: 'observed' }),
      ],
      [],
      NOW,
    );
    expect(score(h, 'governance')).toBe(0.5);
  });

  it('currency measures the adopted canon only', () => {
    const h = computeHealth(
      [
        item({ status: 'adopted', updatedAt: daysAgo(10) }),
        item({ status: 'adopted', updatedAt: daysAgo(200) }),
        // a stale *pending* row is backlog, not stale canon — excluded
        item({ status: 'observed', updatedAt: daysAgo(400) }),
      ],
      [],
      NOW,
    );
    expect(score(h, 'currency')).toBe(0.5);
  });

  it('consistency counts well-formed topic + axes, ignoring rejected rows', () => {
    const h = computeHealth(
      [
        item({ status: 'adopted' }),
        item({ status: 'observed', topic: 'unsorted/needs-topic' }),
        item({ status: 'observed', abstraction: null }),
        // rejected is dedup memory; holding it to current structure would
        // penalize the library for remembering
        item({ status: 'rejected', topic: 'legacy', abstraction: null, ftype: null }),
      ],
      [],
      NOW,
    );
    expect(score(h, 'consistency')).toBeCloseTo(1 / 3);
  });

  it('liquidity ignores na cells and non-canon practices', () => {
    const adopted = item({ status: 'adopted' });
    const pending = item({ status: 'observed' });
    const h = computeHealth(
      [adopted, pending],
      [
        cell(adopted.id, 'adopted', 'p1'),
        cell(adopted.id, 'dispatched', 'p2'),
        cell(adopted.id, 'na', 'p3'), // not applicable ≠ illiquid
        cell(pending.id, 'proposed', 'p1'), // practice isn't canon yet
      ],
      NOW,
    );
    expect(score(h, 'liquidity')).toBe(0.5);
    expect(h.pillars.find((p) => p.key === 'liquidity')!.of).toBe(2);
  });

  it('returns null rather than a fabricated score when there is nothing to measure', () => {
    const h = computeHealth([], [], NOW);
    expect(h.pillars.every((p) => p.score === null)).toBe(true);
    expect(h.overall).toBeNull();
  });

  it('averages only the pillars it could measure', () => {
    // No adoption cells at all → liquidity unmeasurable, and it must not drag
    // the overall down to 0.
    const h = computeHealth([item({ status: 'adopted', updatedAt: daysAgo(1) })], [], NOW);
    expect(score(h, 'liquidity')).toBeNull();
    expect(h.overall).toBe(1);
  });

  it('carries the denominator so a small sample is visible', () => {
    const h = computeHealth([item({ status: 'adopted', decidedAt: NOW })], [], NOW);
    expect(h.pillars.find((p) => p.key === 'governance')!.of).toBe(1);
  });

  it('excludes demo rows from every pillar', () => {
    const h = computeHealth([item({ status: 'adopted', mock: true })], [], NOW);
    expect(h.overall).toBeNull();
  });
});
