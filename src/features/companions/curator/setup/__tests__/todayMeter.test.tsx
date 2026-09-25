/**
 * Today's consumption, against the ceiling declared for it.
 *
 * The rule under test is the one a screenshot of a fresh install would never
 * catch: **the cap is drawn even when nothing has been consumed.** A meter
 * that waited for a non-zero figure would hide the brake exactly when the
 * operator is deciding whether to switch her on - and she never idles, so the
 * brake is the only thing that ever stops her.
 *
 * The two absences are kept apart as well: no ceiling declared is not a
 * ceiling of zero, and a runtime that did not answer is not a run of nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';

vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return {
    ...actual,
    // The real English catalog, so the test asserts the words a reader sees
    // rather than a key name a mock echoed back.
    useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }),
  };
});

const { TodayMeter } = await import('../TodayMeter');
const S = en.companions.setup;

describe('a declared cap is rendered even at zero consumption', () => {
  it('draws 0 of 20 rather than hiding the ceiling', () => {
    const { container } = render(<TodayMeter used="0" cap="20" />);
    const meter = container.querySelector('[data-role="curator-today"]');
    expect(meter?.getAttribute('data-state')).toBe('capped');
    expect(meter?.textContent).toBe(interpolate(S.curator_today_of, { used: '0', cap: '20' }));
    expect(meter?.textContent ?? '').toContain('20');
  });

  it('still draws the ceiling once something has been consumed', () => {
    const { container } = render(<TodayMeter used="7" cap="20" />);
    const text = container.querySelector('[data-role="curator-today"]')?.textContent ?? '';
    expect(text).toContain('7');
    expect(text).toContain('20');
  });
});

describe('an undeclared ceiling is not a ceiling of zero', () => {
  it('says no ceiling is declared and shows no second number', () => {
    const { container } = render(<TodayMeter used="0" cap={null} />);
    const meter = container.querySelector('[data-role="curator-today"]');
    expect(meter?.getAttribute('data-state')).toBe('uncapped');
    expect(meter?.textContent).toBe(interpolate(S.curator_today_uncapped, { used: '0' }));
    expect(meter?.textContent).not.toBe(interpolate(S.curator_today_of, { used: '0', cap: '0' }));
  });
});

describe('an unread runtime is not a consumption of zero', () => {
  it('says the figure could not be read, and prints no figure', () => {
    const { container } = render(<TodayMeter used={null} cap="20" />);
    const meter = container.querySelector('[data-role="curator-today"]');
    expect(meter?.getAttribute('data-state')).toBe('unread');
    expect(meter?.textContent).toBe(S.curator_today_unread);
    expect(meter?.textContent ?? '').not.toMatch(/[0-9]/);
  });
});
