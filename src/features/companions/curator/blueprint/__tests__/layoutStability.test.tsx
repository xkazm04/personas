/**
 * The first visit used to shift the whole page (CLS 0.28-0.47 in the shot
 * harness, 0.677 in the cold-load probe) because three things changed size the
 * moment the plan landed: the verdict label wrapped differently, the projects
 * bar became taller candles, and the bands under the rows were pushed down by
 * every row. jsdom has no layout, so these pin the mechanisms, not the pixels.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';

import { Blueprint } from '../Blueprint';
import { EMPTY_DOCKET } from '../model/docket';
import { buildModel } from '../model/buildModel';
import { unmeasuredModel } from '../model/unmeasured';
import type { BlueprintModel } from '../model/types';
import type { BlueprintPhase } from '../ledger/LedgerEmpty';
import type { BlueprintStrings, BlueprintWords } from '../words';

import { plan } from './fixture';

// Same provenance as unmeasured.test.tsx: the generated type's own source.
const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};
const W = en.companions.blueprint;

function draw(model: BlueprintModel, phase: BlueprintPhase = 'unrun') {
  return render(
    <Blueprint model={model} docket={EMPTY_DOCKET} words={words} phase={phase} console={null} queue={null} />,
  );
}

describe('the plan landing does not move the page', () => {
  it('holds the taller of the two pairs labels in both readings', () => {
    for (const model of [unmeasuredModel(), buildModel(plan())]) {
      const { container, unmount } = draw(model);
      const sizer = container.querySelector('[data-role="cb-verdict-figure"]')
        ?.closest('.cb-vtop')
        ?.querySelector('.cb-lab-stack .cb-lab-sizer');
      expect(sizer?.getAttribute('aria-hidden')).toBe('true');
      expect(sizer?.textContent).not.toBe('');
      unmount();
    }
  });

  it('reserves the candle height on the unmeasured projects bar', () => {
    const { container } = draw(unmeasuredModel());
    const bars = [...container.querySelectorAll<HTMLElement>('.cb-verdict .cb-bar')];
    expect(bars.some((b) => b.style.height === '18px')).toBe(true);
  });

  it('keeps the bands out of the way while the first read is in flight', () => {
    const reading = draw(unmeasuredModel(), 'reading');
    expect(reading.container.querySelectorAll('[data-role="cb-band-row"]')).toHaveLength(0);
    reading.unmount();
    // Once the read settles with no plan they draw, as the unmeasured page says.
    const settled = draw(unmeasuredModel(), 'unrun');
    expect(settled.container.querySelectorAll('[data-role="cb-band-row"]')).toHaveLength(2);
    expect(W.band_unlisted_unmeasured).toBeTruthy();
  });
});
