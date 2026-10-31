import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The selectable-tile markup lives in AppearanceOptionTile only. Counted over
 * the Appearance*Settings pickers + the tile, by the tile's shared class string.
 */
const dir = join(__dirname, '..');
const TILE_CLASSES = 'rounded-modal border transition-colors text-center';

describe('picker option-tile markup is not hand-copied', () => {
  it('exactly one implementation across the Appearance pickers', () => {
    const files = readdirSync(dir).filter((f) => /^Appearance.*\.tsx$/.test(f));
    const owners = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes(TILE_CLASSES));
    expect(owners).toEqual(['AppearanceOptionTile.tsx']);
  });
});
