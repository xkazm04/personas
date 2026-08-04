// Two guarantees this WP depends on:
//  1. the annotations PATCH sends only the keys that actually changed, so
//     rating a member cannot silently wipe its note (and vice versa);
//  2. the library tree / context drawer resolve their membership BY ID, so the
//     "two contexts share a display name" case shipDerive already covers for
//     footprints is covered for those surfaces too.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { inContext } from '../shipDerive';

import { ctx, feature, goal } from './shipFixtures';

const invoke = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/tauriInvoke', () => ({ invokeWithTimeout: invoke }));

const { setMilestoneItem } = await import('@/api/devTools/milestones');

const lastArgs = () => invoke.mock.calls.at(-1)![1] as Record<string, unknown>;

describe('setMilestoneItem annotations patch', () => {
  beforeEach(() => invoke.mockClear());

  it('sends NEITHER key when no annotations are supplied', async () => {
    await setMilestoneItem('m1', 'use_case', 'f1', 'core');
    expect(lastArgs()).toEqual({ milestoneId: 'm1', itemKind: 'use_case', itemId: 'f1', bucket: 'core' });
    expect(lastArgs()).not.toHaveProperty('description');
    expect(lastArgs()).not.toHaveProperty('rating');
  });

  it('sends ONLY rating when only the rating changed', async () => {
    await setMilestoneItem('m1', 'use_case', 'f1', 'core', { rating: 4 });
    expect(lastArgs()).toMatchObject({ rating: 4 });
    expect(lastArgs()).not.toHaveProperty('description');
  });

  it('sends ONLY description when only the note changed', async () => {
    await setMilestoneItem('m1', 'use_case', 'f1', 'core', { description: 'needs a second look' });
    expect(lastArgs()).toMatchObject({ description: 'needs a second look' });
    expect(lastArgs()).not.toHaveProperty('rating');
  });

  it('distinguishes clearing (explicit null) from leaving alone (absent)', async () => {
    await setMilestoneItem('m1', 'use_case', 'f1', 'core', { rating: null });
    expect(lastArgs()).toHaveProperty('rating', null);
    expect(lastArgs()).not.toHaveProperty('description');

    await setMilestoneItem('m1', 'use_case', 'f1', 'core', { description: null });
    expect(lastArgs()).toHaveProperty('description', null);
    expect(lastArgs()).not.toHaveProperty('rating');
  });

  it('round-trips both keys when both changed', async () => {
    await setMilestoneItem('m1', 'use_case', 'f1', 'later', { description: 'deferred', rating: 2 });
    expect(lastArgs()).toMatchObject({ bucket: 'later', description: 'deferred', rating: 2 });
  });
});

describe('inContext — the ID join', () => {
  // The exact collision shipDerive.test.ts pins for footprints.
  const a = ctx('c-a', 'teams/factory', 'ok', 1);
  const b = ctx('c-b', 'teams/factory', 'crit', 1, 40);
  const fA = feature('f-a', 'wall', [a]);
  const fB = feature('f-b', 'spine', [b]);
  const gA = goal('g-a', 'Ship the wall', [a]);
  const gB = goal('g-b', 'Ship the spine', [b]);

  it('does NOT attribute the other context features to a name twin', () => {
    expect(inContext([fA, fB], 'c-a').map((f) => f.id)).toEqual(['f-a']);
    expect(inContext([fA, fB], 'c-b').map((f) => f.id)).toEqual(['f-b']);
  });

  it('keeps goals apart across the same collision', () => {
    expect(inContext([gA, gB], 'c-a').map((g) => g.id)).toEqual(['g-a']);
    expect(inContext([gA, gB], 'c-b').map((g) => g.id)).toEqual(['g-b']);
  });

  it('returns nothing for a context no item slices', () => {
    expect(inContext([fA, fB], 'c-nope')).toEqual([]);
  });

  it('lists a feature under every context it actually slices', () => {
    const both = feature('f-both', 'shell', [a, b]);
    expect(inContext([both], 'c-a')).toHaveLength(1);
    expect(inContext([both], 'c-b')).toHaveLength(1);
  });
});
