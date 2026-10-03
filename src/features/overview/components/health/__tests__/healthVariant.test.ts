/**
 * The switch between the three 2-layer prototypes (kit batch home-3). The page harness writes this
 * same key from `?kit=`, so a wrong or retired id must land on a prototype that exists rather than
 * on a blank surface.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { HEALTH_VARIANT_IDS, readHealthVariant } from '../healthVariant';

const KEY = 'system-check-variant';

describe('readHealthVariant', () => {
  afterEach(() => localStorage.removeItem(KEY));

  it('offers exactly the three prototypes the owner asked for', () => {
    expect(HEALTH_VARIANT_IDS).toEqual(['board', 'spine', 'triage']);
  });

  it.each(['board', 'spine', 'triage'])('keeps a stored %s', (id) => {
    localStorage.setItem(KEY, id);
    expect(readHealthVariant()).toBe(id);
  });

  it.each(['', 'drawer', 'Board', 'a'])('falls back to board for an unknown id: "%s"', (id) => {
    localStorage.setItem(KEY, id);
    expect(readHealthVariant()).toBe('board');
  });

  it('falls back to board when nothing is stored', () => {
    expect(readHealthVariant()).toBe('board');
  });
});
