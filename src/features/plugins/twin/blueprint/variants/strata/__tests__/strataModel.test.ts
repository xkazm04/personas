/**
 * The strata arithmetic: which plate an answer lands on, and the waffle cells
 * that keep a count honest (one cell per memory while they fit, an exact share
 * of the total once they do not, `null` when nothing is measured).
 */
import { describe, it, expect } from 'vitest';

import { FIXTURE_DELTA_INSTANT, FIXTURE_ONE_CHANNEL, FIXTURE_RICH } from '../../../__fixtures__/blueprintFixtures';
import { WAFFLE_CELLS, apportionCells, channelLabel, deltaSection, waffleCells } from '../strataModel';

describe('deltaSection', () => {
  it('follows the goal slot first', () => {
    expect(deltaSection({ ...FIXTURE_DELTA_INSTANT, goalId: 'g1' }, FIXTURE_RICH)).toBe('identity');
    expect(deltaSection({ ...FIXTURE_DELTA_INSTANT, goalId: 'g2' }, FIXTURE_RICH)).toBe('voice');
    expect(deltaSection({ ...FIXTURE_DELTA_INSTANT, goalId: 'g3' }, FIXTURE_RICH)).toBe('voice');
    expect(deltaSection({ ...FIXTURE_DELTA_INSTANT, goalId: 'g4' }, FIXTURE_RICH)).toBe('knowledge');
    expect(deltaSection({ ...FIXTURE_DELTA_INSTANT, goalId: 'g5' }, FIXTURE_RICH)).toBe('training');
  });

  it('then the channel, the topic, the kind', () => {
    const bare = { ...FIXTURE_DELTA_INSTANT, goalId: null, topicId: null, kind: null };
    expect(deltaSection({ ...bare, channel: 'email' }, FIXTURE_ONE_CHANNEL)).toBe('voice');
    expect(deltaSection({ ...bare, topicId: 'values' }, FIXTURE_ONE_CHANNEL)).toBe('training');
    expect(deltaSection({ ...bare, kind: 'fact' }, FIXTURE_ONE_CHANNEL)).toBe('knowledge');
    expect(deltaSection({ ...bare, kind: 'reply_drill' }, FIXTURE_ONE_CHANNEL)).toBe('voice');
    expect(deltaSection(bare, FIXTURE_ONE_CHANNEL)).toBe('training');
  });
});

describe('waffle cells', () => {
  it('one cell per memory while they fit', () => {
    expect(waffleCells({ approved: 4, pending: 3, rejected: 1 })).toEqual({ approved: 4, pending: 3, rejected: 1 });
  });

  it('an exact share of the total once they do not', () => {
    const cells = waffleCells({ approved: 57, pending: 12, rejected: 9 });
    expect(cells).not.toBeNull();
    expect((cells?.approved ?? 0) + (cells?.pending ?? 0) + (cells?.rejected ?? 0)).toBe(WAFFLE_CELLS);
    expect(cells?.approved).toBeGreaterThan(cells?.pending ?? 0);
  });

  it('null when nothing is measured', () => {
    expect(waffleCells({ approved: null, pending: null, rejected: null })).toBeNull();
  });

  it('apportions to the exact cell count', () => {
    expect(apportionCells([1, 1, 1], 100).reduce((s, v) => s + v, 0)).toBe(100);
    expect(apportionCells([0, 0], 100)).toEqual([0, 0]);
  });
});

describe('channelLabel', () => {
  it('uses the product spelling and the translated "everywhere"', () => {
    expect(channelLabel('generic', 'Everywhere')).toBe('Everywhere');
    expect(channelLabel('sms', 'Everywhere')).toBe('SMS');
    expect(channelLabel('whatsapp', 'Everywhere')).toBe('WhatsApp');
    expect(channelLabel('mastodon', 'Everywhere')).toBe('Mastodon');
  });
});
