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

type LiveItemInput = { id: string; status?: string; priority?: string; sortOrder?: number };
type Content = Record<string, { title: string; description: string }>;

function liveWith(
  items: LiveItemInput[],
  content: Content,
  extraLocales: Record<string, Content> = {},
): LiveRoadmap {
  return {
    release: { items: items.map((i) => ({ ...i })) },
    i18n: {
      en: { items: content },
      ...Object.fromEntries(Object.entries(extraLocales).map(([k, v]) => [k, { items: v }])),
    },
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

  it('drops duplicate live ids, keeping the first occurrence', () => {
    const live = liveWith(
      [
        { id: '9', status: 'planned', priority: 'now', sortOrder: 1 },
        { id: '9', status: 'completed', priority: 'later', sortOrder: 2 },
      ],
      { '9': { title: 'Live item', description: 'l9' } },
    );
    const items = buildDisplayItems(BUNDLED, live, 'en', BUNDLED_I18N);
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('planned');
  });

  it('orders live items by sort_order, not payload order', () => {
    const live = liveWith(
      [
        { id: 'b', status: 'planned', priority: 'now', sortOrder: 9 },
        { id: 'a', status: 'planned', priority: 'now', sortOrder: 2 },
      ],
      { a: { title: 'A', description: '' }, b: { title: 'B', description: '' } },
    );
    expect(buildDisplayItems(BUNDLED, live, 'en', BUNDLED_I18N).map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('uses the requested locale when the live payload carries it', () => {
    const live = liveWith(
      [{ id: '9', status: 'planned', priority: 'now' }],
      { '9': { title: 'Live item', description: 'l9' } },
      { cs: { '9': { title: 'Ceska polozka', description: 'c9' } } },
    );
    expect(buildDisplayItems(BUNDLED, live, 'cs', BUNDLED_I18N).map((i) => i.title)).toEqual(['Ceska polozka']);
  });

  it('falls back to the live payload\'s English locale for an untranslated language', () => {
    const live = liveWith(
      [{ id: '9', status: 'planned', priority: 'now' }],
      { '9': { title: 'Live item', description: 'l9' } },
    );
    // 'ja' is absent from i18n — English content wins over blanking the roadmap.
    expect(buildDisplayItems(BUNDLED, live, 'ja', BUNDLED_I18N).map((i) => i.title)).toEqual(['Live item']);
  });

  it('drops a single live item the locale bundle has no content for', () => {
    // The whole-payload fallback does not fire here — one item HAS content — so
    // before this the other item rendered as the literal `[roadmap.b]`.
    const live = liveWith(
      [
        { id: 'a', status: 'planned', priority: 'now', sortOrder: 1 },
        { id: 'b', status: 'planned', priority: 'now', sortOrder: 2 },
      ],
      { a: { title: 'A', description: '' } },
    );
    expect(buildDisplayItems(BUNDLED, live, 'en', BUNDLED_I18N).map((i) => i.title)).toEqual(['A']);
  });

  it('drops bundled items whose i18n entry is missing', () => {
    const items = buildDisplayItems(BUNDLED, null, 'en', { '1': { title: 'Bundled one', description: 'b1' } });
    expect(items.map((i) => i.title)).toEqual(['Bundled one']);
  });

  it('returns nothing rather than placeholder cards when no content resolves at all', () => {
    // An honest empty roadmap; the view renders its empty state instead of a
    // wall of `[roadmap.1]` / `[roadmap.2]`.
    expect(buildDisplayItems(BUNDLED, null, 'en', undefined)).toEqual([]);
  });

  it('falls back to bundled ordering when the live override is undefined', () => {
    const items = buildDisplayItems(BUNDLED, undefined, 'en', BUNDLED_I18N);
    expect(items.map((i) => i.sort_order)).toEqual([1, 2]);
  });
});
