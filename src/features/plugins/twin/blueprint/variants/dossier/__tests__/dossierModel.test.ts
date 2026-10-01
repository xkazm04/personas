/** Dossier (WP9): the declared-domain arithmetic behind the instrument tiles. */
import { describe, expect, it } from 'vitest';

import { FIXTURE_DELTA_INSTANT, FIXTURE_RICH } from '../../../__fixtures__/blueprintFixtures';
import type { BlueprintDelta } from '../../../blueprintContract';
import { BIO_UNITS, bioStrip, channelLabel, deltaSection, foldRows, kindParts, share } from '../dossierModel';

const delta = (over: Partial<BlueprintDelta>): BlueprintDelta => ({ ...FIXTURE_DELTA_INSTANT, goalId: null, topicId: null, kind: null, ...over });

describe('foldRows', () => {
  it('keeps every row that fits and folds the rest into one "+N"', () => {
    expect(foldRows([1, 2, 3], 5)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(foldRows([1, 2, 3, 4, 5], 5)).toEqual({ shown: [1, 2, 3, 4, 5], more: 0 });
    expect(foldRows([1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual({ shown: [1, 2, 3, 4], more: 5 });
  });
});

describe('deltaSection', () => {
  it('lands on the goal slot first', () => {
    expect(deltaSection(delta({ goalId: 'g1' }), FIXTURE_RICH)).toBe('identity');
    expect(deltaSection(delta({ goalId: 'g2' }), FIXTURE_RICH)).toBe('voice');
    expect(deltaSection(delta({ goalId: 'g3' }), FIXTURE_RICH)).toBe('voice');
    expect(deltaSection(delta({ goalId: 'g4' }), FIXTURE_RICH)).toBe('knowledge');
    expect(deltaSection(delta({ goalId: 'g5' }), FIXTURE_RICH)).toBe('training');
  });

  it('then the channel, the topic, the kind', () => {
    expect(deltaSection(delta({ channel: 'email' }), FIXTURE_RICH)).toBe('voice');
    expect(deltaSection(delta({ topicId: 'values' }), FIXTURE_RICH)).toBe('training');
    expect(deltaSection(delta({ kind: 'fact' }), FIXTURE_RICH)).toBe('knowledge');
    expect(deltaSection(delta({ kind: 'rule' }), FIXTURE_RICH)).toBe('voice');
    expect(deltaSection(delta({}), FIXTURE_RICH)).toBe('training');
  });
});

describe('bioStrip', () => {
  it('draws the bio against its target on a 1-2-5 quantum', () => {
    expect(bioStrip(null, 50, BIO_UNITS.glance)).toBeNull();
    const short = bioStrip(30, 50, BIO_UNITS.glance)!;
    expect(short.quantum).toBe(5);
    expect(short.filled).toBe(6);
    expect(short.empty).toBe(4);
    expect(short.targetAt).toBe(10);
    const long = bioStrip(640, 50, BIO_UNITS.glance)!;
    expect(long.quantum).toBe(50);
    expect(long.filled).toBeCloseTo(12.8);
    expect(long.empty).toBe(0);
    expect(long.filled).toBeLessThanOrEqual(BIO_UNITS.glance);
  });

  it('an empty bio is a measured zero against the whole target', () => {
    const zero = bioStrip(0, 50, BIO_UNITS.glance)!;
    expect(zero.filled).toBe(0);
    expect(zero.empty).toBe(zero.targetAt);
  });
});

describe('small helpers', () => {
  it('share clamps to the declared domain', () => {
    expect(share(12, 10)).toBe(1);
    expect(share(5, 10)).toBe(0.5);
    expect(share(-1, 10)).toBe(0);
  });

  it('kindParts keeps display order and drops kinds never answered', () => {
    expect(kindParts({ fact: 2, scene: 3 })).toEqual([
      { kind: 'scene', n: 3 },
      { kind: 'fact', n: 2 },
    ]);
    expect(kindParts({})).toEqual([]);
  });

  it('channelLabel writes products their own way and generic as everywhere', () => {
    expect(channelLabel('generic', 'Everywhere')).toBe('Everywhere');
    expect(channelLabel('whatsapp', 'Everywhere')).toBe('WhatsApp');
    expect(channelLabel('sms', 'Everywhere')).toBe('SMS');
    expect(channelLabel('matrix', 'Everywhere')).toBe('Matrix');
  });
});
