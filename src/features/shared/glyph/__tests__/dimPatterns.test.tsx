import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SigilPatternDefs, petalPatternFill } from '../dimPatterns';
import { GLYPH_DIMENSIONS } from '../types';
import { PETAL_ANGLES } from '../dimMeta';

/**
 * The CVD-safe petal textures are referenced from a `<path>` that lives inside
 * a `translate(cx,cy) rotate(PETAL_ANGLES[dim])` group (CapabilitySigil.tsx).
 * With `patternUnits="userSpaceOnUse"` the SVG spec resolves the pattern in the
 * *referencing element's* user space — the rotated one — so an unrotated
 * pattern tile turns with its petal.
 *
 * That is not cosmetic: the eight textures are only eight distinct shapes at
 * their designed orientation. Turned by their own petal angle, `task` (vertical
 * lines, +45°) and `connector` (forward diagonal, +90°) both land at 135°, and
 * `review` (grid, +180°) and `memory` (cross-hatch, +225°) both land on the
 * same orthogonal grid — collapsing two pairs in the exact vocabulary that
 * exists so the petals can be told apart WITHOUT colour (WCAG 1.4.1).
 *
 * The counter-rotation below is what keeps each texture at its designed
 * orientation on screen. Pinned here because nothing else can observe it.
 */
function renderDefs() {
  return render(
    <svg>
      <defs>
        <SigilPatternDefs uid="test-uid" />
      </defs>
    </svg>,
  );
}

describe('SigilPatternDefs', () => {
  it('emits one uniquely-identified pattern per dimension', () => {
    const { container } = renderDefs();
    const patterns = Array.from(container.querySelectorAll('pattern'));
    expect(patterns).toHaveLength(GLYPH_DIMENSIONS.length);

    const ids = patterns.map((p) => p.getAttribute('id'));
    expect(new Set(ids).size).toBe(GLYPH_DIMENSIONS.length);
    for (const dim of GLYPH_DIMENSIONS) {
      expect(petalPatternFill(dim, 'test-uid')).toBe(`url(#sigil-pat-${dim}-test-uid)`);
      expect(ids).toContain(`sigil-pat-${dim}-test-uid`);
    }
  });

  it('counter-rotates every texture by its own petal angle', () => {
    const { container } = renderDefs();
    for (const dim of GLYPH_DIMENSIONS) {
      const pattern = container.querySelector(`#sigil-pat-${dim}-test-uid`);
      expect(pattern, `no pattern emitted for "${dim}"`).not.toBeNull();
      expect(
        pattern!.getAttribute('patternTransform'),
        `"${dim}" texture would turn with its petal and stop being distinguishable`,
      ).toBe(`rotate(${-PETAL_ANGLES[dim]})`);
    }
  });

  it('leaves the tile in user space so the counter-rotation is meaningful', () => {
    const { container } = renderDefs();
    for (const pattern of Array.from(container.querySelectorAll('pattern'))) {
      expect(pattern.getAttribute('patternUnits')).toBe('userSpaceOnUse');
    }
  });
});
