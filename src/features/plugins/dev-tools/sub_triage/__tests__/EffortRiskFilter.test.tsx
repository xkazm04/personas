/**
 * The effort / risk presets must partition the scale the ratings are stored on.
 *
 * The ratings moved to 1-5 (`IDEA_SCALE_MAX`, 2026-09-21) and the presets kept
 * their ten-point bands: Heavy and Risky (7-10) matched no idea at all, and
 * Moderate (4-6) held the heaviest ones. The scale is read from the Rust source
 * so the next rescale fails here instead of in the Backlog.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { EffortRiskFilter, LEVEL_PRESETS } from '../EffortRiskFilter';

function ideaScaleMax(): number {
  const src = readFileSync(resolve(process.cwd(), 'src-tauri/core/src/models/dev_tools.rs'), 'utf8')
    .replace(/\/\/.*$/gm, '');
  const m = /pub const IDEA_SCALE_MAX:\s*i32\s*=\s*(\d+);/.exec(src);
  if (!m) throw new Error('IDEA_SCALE_MAX not found in dev_tools.rs');
  return Number(m[1]);
}

describe('EffortRiskFilter presets', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['common']);
  });

  const max = ideaScaleMax();

  for (const group of ['effort', 'risk'] as const) {
    it(`${group}: every stored rating 1..${max} falls in exactly one preset`, () => {
      for (let v = 1; v <= max; v++) {
        const hits = LEVEL_PRESETS[group].filter((p) => v >= p.range[0] && v <= p.range[1]);
        expect(hits.map((p) => p.label), `rating ${v}`).toHaveLength(1);
      }
    });

    it(`${group}: no preset reaches past the scale`, () => {
      for (const p of LEVEL_PRESETS[group]) {
        expect(p.range[0], p.label).toBeGreaterThanOrEqual(1);
        expect(p.range[1], p.label).toBeLessThanOrEqual(max);
      }
    });
  }

  it('Heavy and Risky select the top of the scale, the band the rule suggestions mine', () => {
    const onEffortChange = vi.fn();
    const onRiskChange = vi.fn();
    render(
      <EffortRiskFilter
        effortRange={[1, 10]}
        riskRange={[1, 10]}
        onEffortChange={onEffortChange}
        onRiskChange={onRiskChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Heavy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Risky' }));
    expect(onEffortChange).toHaveBeenCalledWith([4, max]);
    expect(onRiskChange).toHaveBeenCalledWith([4, max]);
  });
});
