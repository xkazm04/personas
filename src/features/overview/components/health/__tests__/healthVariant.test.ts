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

  it('offers the fusion plus the three studies it was composed from', () => {
    expect(HEALTH_VARIANT_IDS).toEqual(['fusion', 'board', 'spine', 'triage']);
  });

  it.each(['fusion', 'board', 'spine', 'triage'])('keeps a stored %s', (id) => {
    localStorage.setItem(KEY, id);
    expect(readHealthVariant()).toBe(id);
  });

  it.each(['', 'drawer', 'Board', 'a'])('falls back to the fusion for an unknown id: "%s"', (id) => {
    localStorage.setItem(KEY, id);
    expect(readHealthVariant()).toBe('fusion');
  });

  it('defaults to the fusion, which is the one proposed for shipping', () => {
    expect(readHealthVariant()).toBe('fusion');
  });
});
