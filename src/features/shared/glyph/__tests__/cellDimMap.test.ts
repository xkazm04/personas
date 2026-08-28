import { describe, it, expect } from 'vitest';
import { CELL_KEY_TO_DIM, DIM_TO_CELL_KEY } from '../persona-sigil/cellDimMap';
import { GLYPH_DIMENSIONS } from '../types';

/**
 * `DIM_TO_CELL_KEY` is indexed with a dimension and its type promises a
 * `string` back. The annotation on the literal is the compile-time half of
 * that promise; these are the runtime half — plus the round-trip, which is
 * the property the two maps existing at all is for.
 */
describe('cell-key ↔ dimension map', () => {
  it('gives every dimension a cell key', () => {
    for (const dim of GLYPH_DIMENSIONS) {
      expect(DIM_TO_CELL_KEY[dim], `no cell key for dimension "${dim}"`).toBeTruthy();
    }
    expect(Object.keys(DIM_TO_CELL_KEY).sort()).toEqual([...GLYPH_DIMENSIONS].sort());
  });

  it('gives every dimension its own cell key', () => {
    const keys = GLYPH_DIMENSIONS.map((dim) => DIM_TO_CELL_KEY[dim]);
    expect(new Set(keys).size, `two dimensions share a cell key: ${keys.join(', ')}`)
      .toBe(GLYPH_DIMENSIONS.length);
  });

  it('round-trips every dimension through the forward map', () => {
    for (const dim of GLYPH_DIMENSIONS) {
      expect(CELL_KEY_TO_DIM[DIM_TO_CELL_KEY[dim]], `"${dim}" does not round-trip`).toBe(dim);
    }
  });

  it('keeps the sample-output alias pointing at the task petal', () => {
    // `sample-output` and `use-cases` share the task petal; only `use-cases`
    // is the canonical key that comes back on the reverse lookup.
    expect(CELL_KEY_TO_DIM['sample-output']).toBe('task');
    expect(DIM_TO_CELL_KEY.task).toBe('use-cases');
  });

  it('resolves every forward key to a real dimension', () => {
    for (const [cellKey, dim] of Object.entries(CELL_KEY_TO_DIM)) {
      expect(GLYPH_DIMENSIONS, `"${cellKey}" maps outside the vocabulary`).toContain(dim);
    }
  });
});
