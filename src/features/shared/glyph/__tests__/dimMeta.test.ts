import { describe, it, expect } from 'vitest';
import { GLYPH_DIMENSIONS } from '../types';
import { DIM_META, PETAL_ANGLES } from '../dimMeta';
import { petalPatternFill } from '../dimPatterns';

/**
 * The sigil's whole visual language rests on two vocabularies being
 * *distinct*: eight dimension colours (hue channel) and eight CVD-safe
 * textures (shape channel). Nothing derived either from a source of truth,
 * and nothing asserted the distinctness — so a palette tune or a ninth
 * dimension could quietly collapse two petals into the same read.
 *
 * These assertions only pin properties the design already requires. They
 * fail the moment a duplicate colour lands or a dimension orphans.
 */
describe('DIM_META', () => {
  it('covers exactly the canonical dimension vocabulary', () => {
    expect(Object.keys(DIM_META).sort()).toEqual([...GLYPH_DIMENSIONS].sort());
    for (const dim of GLYPH_DIMENSIONS) {
      expect(DIM_META[dim], `no meta for dimension "${dim}"`).toBeDefined();
    }
  });

  it('gives every dimension a pairwise-distinct colour', () => {
    const colors = GLYPH_DIMENSIONS.map((dim) => DIM_META[dim].color.toLowerCase());
    expect(new Set(colors).size, `duplicate colour among ${colors.join(', ')}`)
      .toBe(GLYPH_DIMENSIONS.length);
  });

  it('states every colour as a 6-digit hex so CVD remapping can parse it', () => {
    for (const dim of GLYPH_DIMENSIONS) {
      expect(DIM_META[dim].color, `"${dim}" colour is not #rrggbb`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('gives every dimension a pairwise-distinct tailwind colour class', () => {
    const classes = GLYPH_DIMENSIONS.map((dim) => DIM_META[dim].colorClass);
    expect(new Set(classes).size, `duplicate colorClass among ${classes.join(', ')}`)
      .toBe(GLYPH_DIMENSIONS.length);
  });

  it('gives every dimension a pairwise-distinct label key', () => {
    const keys = GLYPH_DIMENSIONS.map((dim) => DIM_META[dim].labelKey);
    expect(new Set(keys).size, `duplicate labelKey among ${keys.join(', ')}`)
      .toBe(GLYPH_DIMENSIONS.length);
  });

  it('gives every dimension its own aura art component', () => {
    const arts = GLYPH_DIMENSIONS.map((dim) => DIM_META[dim].customArt);
    for (const dim of GLYPH_DIMENSIONS) {
      expect(DIM_META[dim].customArt, `"${dim}" has no customArt`).toBeDefined();
    }
    expect(new Set(arts).size).toBe(GLYPH_DIMENSIONS.length);
  });
});

describe('PETAL_ANGLES', () => {
  it('places every dimension at its own angle on the circle', () => {
    const angles = GLYPH_DIMENSIONS.map((dim) => PETAL_ANGLES[dim]);
    expect(angles).toHaveLength(GLYPH_DIMENSIONS.length);
    expect(new Set(angles).size, `duplicate angle among ${angles.join(', ')}`)
      .toBe(GLYPH_DIMENSIONS.length);
    for (const angle of angles) {
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(360);
    }
  });
});

describe('CVD-safe texture vocabulary', () => {
  it('maps every dimension to its own texture, not just its own colour', () => {
    const fills = GLYPH_DIMENSIONS.map((dim) => petalPatternFill(dim, 'uid'));
    expect(new Set(fills).size, `duplicate texture fill among ${fills.join(', ')}`)
      .toBe(GLYPH_DIMENSIONS.length);
  });
});
