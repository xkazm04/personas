import { describe, it, expect } from 'vitest';

import type { Release } from '@/data/releases';
import type { LiveRoadmap } from '@/api/liveRoadmap';

import { buildDisplayItems } from './roadmapItems';

const BUNDLED: Release = {
  version: 'roadmap',
  status: 'roadmap',
  items: [
    { id: '1', type: 'feature', status: 'in_progress', priority: 'now', sort_order: 1 },
    { id: '2', type: 'feature', status: 'planned', priority: 'next', sort_order: 2 },
  ],
} as unknown as Release;

const BUNDLED_I18N = {
  '1': { title: 'Bundled one', description: 'b1' },
  '2': { title: 'Bundled two', description: 'b2' },
};

function liveWith(items: Array<{ id: string; status?: string; priority?: string }>, content: Record<string, { title: string; description: string }>): LiveRoadmap {
  return {
    release: { items: items.map((i) => ({ ...i })) },
    i18n: { en: { items: content } },
  } as unknown as LiveRoadmap;
}

describe('buildDisplayItems', () => {
  it('uses bundled content when there is no live override', () => {
    const items = buildDisplayItems(BUNDLED, null, 'en', BUNDLED_I18N);
    expect(items.map((i) => i.title)).toEqual(['Bundled one', 'Bundled two']);
    expect(items[0]!.status).toBe('in_progress');
  });

  it('prefers the live payload when it has displayable content', () => {
    const live = liveWith(
      [{ id: '9', status: 'in_progress', priority: 'now' }],
      { '9': { title: 'Live item', description: 'l9' } },
    );
    const items = buildDisplayItems(BUNDLED, live, 'en', BUNDLED_I18N);
    expect(items.map((i) => i.title)).toEqual(['Live item']);
  });

  it('falls back to bundled content when the live payload yields nothing displayable', () => {
    // Live items exist but have no matching locale content → placeholders only.
    const live = liveWith([{ id: '9', status: 'planned', priority: 'later' }], {});
    const items = buildDisplayItems(BUNDLED, live, 'en', BUNDLED_I18N);
    expect(items.map((i) => i.title)).toEqual(['Bundled one', 'Bundled two']);
  });

  it('coerces unknown live status/priority to known buckets', () => {
    const live = liveWith(
      [{ id: '9', status: 'archived', priority: 'someday' }],
      { '9': { title: 'Live item', description: 'l9' } },
    );
    const items = buildDisplayItems(BUNDLED, live, 'en', BUNDLED_I18N);
    expect(items[0]!.status).toBe('planned');
    expect(items[0]!.priority).toBe('later');
  });
});
