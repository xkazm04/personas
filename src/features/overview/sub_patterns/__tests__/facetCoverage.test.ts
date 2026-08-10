// Facet-grade measurement — the coverage keying contract. What matters:
// coverage is keyed at FULL topic depth so a facet node can carry its own
// ring, a cluster value is the AGGREGATE over its facets plus its direct
// items, mixed-depth clusters produce both grains, and 2-segment topics are
// unchanged (no double-counting into their own key).
import { describe, expect, it } from 'vitest';

import { foldTopicCoverage, topicCoverageKeys } from '../graph/graphModel';
import type { KnowledgeItemView } from '../libraryModel';

function item(id: string, topic: string): KnowledgeItemView {
  return {
    id,
    kind: 'pattern',
    status: 'adopted',
    title: `T-${id}`,
    statement: '',
    topic,
    layers: [],
    frameworks: [],
    originProjectId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    decidedAt: null,
    confidence: null,
    abstraction: null,
    ftype: null,
    durability: null,
    governingId: null,
    evidenceCount: null,
  } as KnowledgeItemView;
}

describe('topicCoverageKeys', () => {
  it('keeps the full path AND the cluster for a 3-segment topic', () => {
    expect(topicCoverageKeys('data/migrations/table-rebuild')).toEqual({
      area: 'data',
      cluster: 'data/migrations',
      full: 'data/migrations/table-rebuild',
    });
  });

  it('collapses full to the cluster key for a 2-segment topic', () => {
    expect(topicCoverageKeys('data/migrations')).toEqual({
      area: 'data',
      cluster: 'data/migrations',
      full: 'data/migrations',
    });
  });

  it('applies the `general` cluster fallback for a bare area', () => {
    expect(topicCoverageKeys('data')).toEqual({
      area: 'data',
      cluster: 'data/general',
      full: 'data/general',
    });
    expect(topicCoverageKeys('')).toBeNull();
  });
});

describe('foldTopicCoverage', () => {
  it('gives each facet its own ratio and the cluster their aggregate', () => {
    const items = [
      item('1', 'data/migrations/table-rebuild'),
      item('2', 'data/migrations/table-rebuild'),
      item('3', 'data/migrations/backfill'),
    ];
    const parts: Record<string, { num: number; den: number }> = {
      1: { num: 1, den: 1 },
      2: { num: 0, den: 1 },
      3: { num: 1, den: 1 },
    };
    const { topic, area } = foldTopicCoverage(items, (i) => parts[i.id]!);
    expect(topic.get('data/migrations/table-rebuild')).toBe(0.5);
    expect(topic.get('data/migrations/backfill')).toBe(1);
    // Cluster = (1+0+1)/3, not the mean of the facet ratios.
    expect(topic.get('data/migrations')).toBeCloseTo(2 / 3);
    expect(area.get('data')).toBeCloseTo(2 / 3);
  });

  it('handles a mixed-depth cluster — faceted and direct items in one key', () => {
    const items = [item('1', 'data/migrations/backfill'), item('2', 'data/migrations')];
    const { topic } = foldTopicCoverage(items, (i) => ({ num: i.id === '1' ? 1 : 0, den: 1 }));
    expect(topic.get('data/migrations/backfill')).toBe(1);
    expect(topic.get('data/migrations')).toBe(0.5);
    expect([...topic.keys()].sort()).toEqual(['data/migrations', 'data/migrations/backfill']);
  });

  it('does not double-count a 2-segment topic into its own key', () => {
    const items = [item('1', 'frontend/loading')];
    const { topic } = foldTopicCoverage(items, () => ({ num: 1, den: 2 }));
    expect(topic.get('frontend/loading')).toBe(0.5);
  });

  it('ignores unmeasurable practices instead of diluting their neighbours', () => {
    const items = [item('1', 'api/contracts'), item('2', 'api/contracts')];
    const { topic, area } = foldTopicCoverage(items, (i) =>
      i.id === '1' ? { num: 1, den: 1 } : null,
    );
    expect(topic.get('api/contracts')).toBe(1);
    expect(area.get('api')).toBe(1);
  });

  it('drops a zero denominator and an empty topic', () => {
    const items = [item('1', 'api/contracts'), item('2', '')];
    const { topic } = foldTopicCoverage(items, () => ({ num: 0, den: 0 }));
    expect(topic.size).toBe(0);
  });
});
