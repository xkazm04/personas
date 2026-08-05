/**
 * Nothing a verdict turns on is colour-only.
 *
 * Two of the facts a reviewer weighs before deciding were legible ONLY if you
 * can see colour:
 *
 *  (a) `TriageFactRow` rendered a fact's tone as `TONE_TEXT[fact.tone]` and
 *      nothing else — no glyph, no qualifier, no label. "Severity: critical"
 *      and "Team: platform" were the same string in two hues.
 *  (b) `MetricBadgeRow` prints the number as text, but good-vs-bad — the entire
 *      purpose of `invert`, which is why "Effort 2" is good news and "Risk 9" is
 *      not — was a hue, and the meter drawing the same reading is `aria-hidden`.
 *
 * WCAG 1.4.1 is the rule; the reason is that this is the surface where a verdict
 * gets written. The tone palette is unchanged — this is added signal.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { MetricBadgeRow } from '../deck/MetricBadgeRow';
import { TriageFactRow } from '../deck/TriageFactRow';
import type { TriageFact } from '../triageTypes';

// This repo's test setup does not auto-cleanup.
afterEach(cleanup);

/** The rendered value cell for a fact, by its label. */
function valueCell(container: HTMLElement, label: string): HTMLElement {
  const dt = Array.from(container.querySelectorAll('dt')).find((el) => el.textContent === label);
  expect(dt).toBeTruthy();
  return dt!.nextElementSibling as HTMLElement;
}

describe('a toned fact says its tone in more than colour', () => {
  const facts: TriageFact[] = [
    { id: 'severity', label: 'Severity', value: 'critical', tone: 'danger' },
    { id: 'progress', label: 'Progress', value: '3 of 10', tone: 'warning' },
    { id: 'quality', label: 'Quality', value: '+12%', tone: 'success' },
    { id: 'team', label: 'Team', value: 'platform' },
  ];

  it('carries a glyph AND a word for every non-neutral tone', () => {
    const { container } = render(<TriageFactRow facts={facts} />);

    for (const [label, word] of [
      ['Severity', 'Poor'],
      ['Progress', 'Fair'],
      ['Quality', 'Good'],
    ] as const) {
      const cell = valueCell(container, label);
      // Sighted, no colour needed.
      expect(cell.querySelector('svg')).toBeTruthy();
      // The same fact for a screen reader, which sees neither glyph nor hue.
      expect(cell.querySelector('.sr-only')?.textContent).toBe(word);
    }
  });

  it('leaves an untoned fact plain — the absence of a flag is information too', () => {
    const { container } = render(<TriageFactRow facts={facts} />);
    const cell = valueCell(container, 'Team');
    expect(cell.querySelector('svg')).toBeNull();
    expect(cell.querySelector('.sr-only')).toBeNull();
    expect(cell.textContent).toBe('platform');
  });

  it('still prints the value itself', () => {
    const { container } = render(<TriageFactRow facts={facts} />);
    expect(valueCell(container, 'Severity').textContent).toContain('critical');
  });
});

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
