/**
 * The switch between the five 2-layer prototypes (kit batch home-3). The page harness writes this
 * same key from `?kit=`, so a wrong or retired id must land on a prototype that exists rather than
 * on a blank surface.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { HEALTH_VARIANT_IDS, readHealthVariant } from '../healthVariant';

const KEY = 'system-check-variant';

describe('readHealthVariant', () => {
  afterEach(() => localStorage.removeItem(KEY));

  it('offers the machine, the fusion, and the three studies the fusion was composed from', () => {
    expect(HEALTH_VARIANT_IDS).toEqual(['machine', 'fusion', 'board', 'spine', 'triage']);
  });

  it.each(['machine', 'fusion', 'board', 'spine', 'triage'])('keeps a stored %s', (id) => {
    localStorage.setItem(KEY, id);
    expect(readHealthVariant()).toBe(id);
  });

  it.each(['', 'drawer', 'Board', 'a'])('falls back to the machine for an unknown id: "%s"', (id) => {
    localStorage.setItem(KEY, id);
    expect(readHealthVariant()).toBe('machine');
  });

  it('defaults to the machine, which is the one proposed for shipping (doctrine 6c)', () => {
    expect(readHealthVariant()).toBe('machine');
  });
});
