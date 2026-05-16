import { describe, expect, it } from 'vitest';
import type { ArtistAsset } from '@/api/artist';
import { groupAssetsByDay } from '../groupByDay';

function makeAsset(createdAt: string, id = createdAt): ArtistAsset {
  return {
    id,
    fileName: `${id}.png`,
    filePath: `/tmp/${id}.png`,
    assetType: '2d',
    mimeType: 'image/png',
    fileSize: 1,
    width: 1,
    height: 1,
    thumbnailPath: null,
    tags: null,
    source: null,
    createdAt,
  };
}

// Anchor `now` mid-week (Wednesday) so the "this week" bucket is non-trivial
// (today, yesterday, this-week all distinct) and the older buckets line up
// predictably. Sunday-anchored week start matches the implementation.
const NOW = new Date('2026-05-13T12:00:00Z'); // Wednesday

describe('groupAssetsByDay', () => {
  it('returns empty array when no assets', () => {
    expect(groupAssetsByDay([], NOW)).toEqual([]);
  });

  it('drops empty buckets', () => {
    const asset = makeAsset('2026-05-13T11:00:00Z');
    const groups = groupAssetsByDay([asset], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.labelKey).toBe('group_today');
  });

  it('buckets a same-day asset as today', () => {
    const asset = makeAsset('2026-05-13T00:30:00Z');
    const [today] = groupAssetsByDay([asset], NOW);
    expect(today?.labelKey).toBe('group_today');
    expect(today?.assets).toHaveLength(1);
  });

  it('buckets yesterday as yesterday', () => {
    const asset = makeAsset('2026-05-12T18:00:00Z');
    const [bucket] = groupAssetsByDay([asset], NOW);
    expect(bucket?.labelKey).toBe('group_yesterday');
  });

  it('buckets earlier-in-week as this_week (but not today / yesterday)', () => {
    // Sunday-anchored week starting 2026-05-10. Monday 2026-05-11 sits in
    // this_week, not today or yesterday.
    const asset = makeAsset('2026-05-11T10:00:00Z');
    const [bucket] = groupAssetsByDay([asset], NOW);
    expect(bucket?.labelKey).toBe('group_this_week');
  });

  it('buckets earlier-in-month as this_month', () => {
    const asset = makeAsset('2026-05-02T10:00:00Z');
    const [bucket] = groupAssetsByDay([asset], NOW);
    expect(bucket?.labelKey).toBe('group_this_month');
  });

  it('buckets prior-month as older', () => {
    const asset = makeAsset('2026-04-15T10:00:00Z');
    const [bucket] = groupAssetsByDay([asset], NOW);
    expect(bucket?.labelKey).toBe('group_older');
  });

  it('emits buckets in chronological-newest-first order', () => {
    const assets = [
      makeAsset('2026-04-01T10:00:00Z', 'older'),
      makeAsset('2026-05-13T08:00:00Z', 'today'),
      makeAsset('2026-05-02T10:00:00Z', 'this_month'),
      makeAsset('2026-05-12T08:00:00Z', 'yesterday'),
      makeAsset('2026-05-11T10:00:00Z', 'this_week'),
    ];
    const groups = groupAssetsByDay(assets, NOW);
    expect(groups.map((g) => g.labelKey)).toEqual([
      'group_today',
      'group_yesterday',
      'group_this_week',
      'group_this_month',
      'group_older',
    ]);
  });

  it('handles unparseable createdAt by bucketing as older', () => {
    const asset = makeAsset('not a date', 'bad');
    const [bucket] = groupAssetsByDay([asset], NOW);
    expect(bucket?.labelKey).toBe('group_older');
    expect(bucket?.assets[0]?.id).toBe('bad');
  });

  it('preserves asset identity inside its bucket', () => {
    const today = makeAsset('2026-05-13T08:00:00Z', 'A');
    const todayB = makeAsset('2026-05-13T09:00:00Z', 'B');
    const [bucket] = groupAssetsByDay([today, todayB], NOW);
    expect(bucket?.assets.map((a) => a.id)).toEqual(['A', 'B']);
  });
});
