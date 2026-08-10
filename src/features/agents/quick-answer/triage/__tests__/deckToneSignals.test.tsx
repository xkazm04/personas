/**
 * Nothing a verdict turns on is colour-only.
 *
 * `MetricBadgeRow` prints the number as text, but good-vs-bad — the entire
 * purpose of `invert`, which is why "Effort 2" is good news and "Risk 9" is not
 * — was a hue, and the meter drawing the same reading is `aria-hidden`.
 *
 * WCAG 1.4.1 is the rule; the reason is that this is the surface where a verdict
 * gets written. The tone palette is unchanged — this is added signal.
 *
 * A second case used to live here: `TriageFactRow`, the docked ledger, rendered
 * a fact's tone as `TONE_TEXT[fact.tone]` and nothing else. The row was removed
 * from the card entirely (the height went back to the prose), so the coverage
 * went with it rather than being weakened into a test of nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { MetricBadgeRow } from '../deck/MetricBadgeRow';

// This repo's test setup does not auto-cleanup.
afterEach(cleanup);

describe('a metric badge says which way is good', () => {
  const badge = (container: HTMLElement, label: string) =>
    Array.from(container.querySelectorAll('div')).find(
      (el) => el.firstElementChild?.textContent === label,
    )!;

  it('reads a LOW inverted score as good and a HIGH one as poor', () => {
    // `invert` is the whole point: effort and risk are scales where low is the
    // good news. Both used to be expressible only as a colour.
    const { container } = render(
      <MetricBadgeRow
        facts={[
          { id: 'effort', label: 'Effort', value: '2', score: { value: 2, max: 10, invert: true } },
          { id: 'risk', label: 'Risk', value: '9', score: { value: 9, max: 10, invert: true } },
        ]}
      />,
    );

    expect(badge(container, 'Effort').querySelector('.sr-only')?.textContent).toBe('Good');
    expect(badge(container, 'Risk').querySelector('.sr-only')?.textContent).toBe('Poor');
  });

  it('reads a plain score the other way round', () => {
    const { container } = render(
      <MetricBadgeRow
        facts={[
          { id: 'impact', label: 'Impact', value: '9', score: { value: 9, max: 10 } },
          { id: 'confidence', label: 'Confidence', value: '2', score: { value: 2, max: 10 } },
        ]}
      />,
    );

    expect(badge(container, 'Impact').querySelector('.sr-only')?.textContent).toBe('Good');
    expect(badge(container, 'Confidence').querySelector('.sr-only')?.textContent).toBe('Poor');
  });

  it('draws the band as a glyph, and keeps the duplicate meter out of the reading', () => {
    const { container } = render(
      <MetricBadgeRow
        facts={[{ id: 'risk', label: 'Risk', value: '9', score: { value: 9, max: 10 } }]}
      />,
    );

    const pill = badge(container, 'Risk');
    expect(pill.querySelector('svg')).toBeTruthy();
    // The meter is a second drawing of the number beside it; reading it out
    // twice is noise, not access.
    expect(pill.querySelector('[aria-hidden="true"].relative')).toBeTruthy();
  });
});
