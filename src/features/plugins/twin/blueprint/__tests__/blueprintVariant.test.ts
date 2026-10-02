/**
 * The switcher's persisted pick (spark twin-portable-blueprint). Round 4
 * retired the drafting sheet's theme versions (`draftingTint`,
 * `draftingSurface`, `draftingNative`): a pick stored before then, or any
 * other id that no longer exists, falls back to the default `drafting`
 * (which now renders the "Personas blueprint" look); a kept id is kept.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { BLUEPRINT_VARIANT_IDS } from '../blueprintContract';
import { readBlueprintVariant } from '../blueprintVariant';

const KEY = 'twin-blueprint-variant';

describe('readBlueprintVariant', () => {
  afterEach(() => localStorage.removeItem(KEY));

  it('the switcher offers two variants: the Personas blueprint and Strata', () => {
    expect(BLUEPRINT_VARIANT_IDS).toEqual(['drafting', 'strata']);
  });

  it.each(['drafting', 'strata'])('keeps a stored %s', (id) => {
    localStorage.setItem(KEY, id);
    expect(readBlueprintVariant()).toBe(id);
  });

  it.each(['draftingTint', 'draftingSurface', 'draftingNative', 'dossier', 'radial', ''])('falls back to drafting for a retired or unknown id: "%s"', (id) => {
    localStorage.setItem(KEY, id);
    expect(readBlueprintVariant()).toBe('drafting');
  });

  it('falls back to drafting when nothing is stored', () => {
    expect(readBlueprintVariant()).toBe('drafting');
  });
});
