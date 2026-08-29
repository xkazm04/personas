import { describe, it, expect, afterEach } from 'vitest';
import { formatPercent, formatCount, formatNumeric, formatCompactNumber, compactWithTitle, formatCost, formatTimestamp, formatRelativeTime, getStatusEntry, EXECUTION_STATUS_MAP } from '../formatters';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useI18nStore } from '@/stores/i18nStore';

describe('formatPercent', () => {
  it('treats the input as a percentage magnitude by default', () => {
    expect(formatPercent(42.5)).toBe('42.5%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('converts a 0–1 ratio when fromRatio is set', () => {
    expect(formatPercent(0.425, { fromRatio: true })).toBe('42.5%');
    expect(formatPercent(1, { fromRatio: true })).toBe('100.0%');
  });

  it('honors a fixed precision so columns stay aligned', () => {
    expect(formatPercent(7, { precision: 0 })).toBe('7%');
    expect(formatPercent(7, { precision: 2 })).toBe('7.00%');
  });

  it('renders an em dash for null / NaN', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(NaN)).toBe('—');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('renders an em dash for null / NaN', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(NaN)).toBe('—');
  });
});

describe('formatCompactNumber', () => {
  it('keeps full grouping below the 10k threshold', () => {
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(999)).toBe('999');
    expect(formatCompactNumber(1234)).toBe('1,234');
    expect(formatCompactNumber(9999)).toBe('9,999');
  });

  it('switches to compact notation at and above the threshold', () => {
    expect(formatCompactNumber(10_000)).toBe('10K');
    expect(formatCompactNumber(12_345)).toBe('12.3K');
    expect(formatCompactNumber(1_200_000)).toBe('1.2M');
    expect(formatCompactNumber(3_400_000_000)).toBe('3.4B');
  });

  it('honors a custom threshold and precision', () => {
    expect(formatCompactNumber(1500, { threshold: 1000 })).toBe('1.5K');
    expect(formatCompactNumber(1_234_567, { precision: 2 })).toBe('1.23M');
  });

  it('handles negatives by magnitude', () => {
    expect(formatCompactNumber(-12_345)).toBe('-12.3K');
    expect(formatCompactNumber(-1234)).toBe('-1,234');
  });

  it('renders an em dash for null / NaN', () => {
    expect(formatCompactNumber(null)).toBe('—');
    expect(formatCompactNumber(undefined)).toBe('—');
    expect(formatCompactNumber(NaN)).toBe('—');
  });
});

describe('compactWithTitle', () => {
  it('pairs the compact display with a full-precision title', () => {
    expect(compactWithTitle(12_345)).toEqual({ display: '12.3K', title: '12,345' });
  });

  it('returns identical display and title below the threshold', () => {
    expect(compactWithTitle(1234)).toEqual({ display: '1,234', title: '1,234' });
  });
});

describe('formatNumeric', () => {
  it('dispatches ms / s durations', () => {
    expect(formatNumeric(4200, 'ms')).toBe('4s');
    expect(formatNumeric(90, 's')).toBe('1m 30s');
  });

  it('dispatches usd cost', () => {
    expect(formatNumeric(1.5, 'usd')).toBe('$1.50');
  });

  it('dispatches percent and ratio', () => {
    expect(formatNumeric(42.5, 'percent')).toBe('42.5%');
    expect(formatNumeric(0.425, 'ratio')).toBe('42.5%');
  });

  it('dispatches count / plain with grouping', () => {
    expect(formatNumeric(1234, 'count')).toBe('1,234');
    expect(formatNumeric(1234, 'plain')).toBe('1,234');
    expect(formatNumeric(1234)).toBe('1,234');
  });

  it('dispatches compact for large counts', () => {
    expect(formatNumeric(12_345, 'compact')).toBe('12.3K');
    expect(formatNumeric(1234, 'compact')).toBe('1,234');
  });

  it('renders an em dash for null / NaN regardless of unit', () => {
    expect(formatNumeric(null, 'usd')).toBe('—');
    expect(formatNumeric(NaN, 'percent')).toBe('—');
  });
});

describe('formatTimestamp', () => {
  // Regression guards. `formatTimestamp` used to call `toLocaleString()` with
  // no locale (so dates followed the OS while numbers in the same file followed
  // the app language) and had no invalid-date guard (so "Invalid Date" reached
  // the UI). Pins the fixed expressions and forbids the old ones.
  it('formats in the requested locale, not the operating system default', () => {
    const iso = '2026-03-04 05:06:07';
    const de = formatTimestamp(iso, '-', { language: 'de' });
    const en = formatTimestamp(iso, '-', { language: 'en-US' });
    expect(de).toBe(new Date('2026-03-04T05:06:07Z').toLocaleString('de'));
    expect(en).toBe(new Date('2026-03-04T05:06:07Z').toLocaleString('en-US'));
    expect(de).not.toBe(en);
  });

  it('returns the fallback for an unparseable timestamp instead of "Invalid Date"', () => {
    expect(formatTimestamp('not-a-date')).toBe('-');
    expect(formatTimestamp('not-a-date', 'Never')).toBe('Never');
    expect(formatTimestamp('not-a-date')).not.toContain('Invalid');
  });

  it('returns the fallback for null/undefined', () => {
    expect(formatTimestamp(null)).toBe('-');
    expect(formatTimestamp(undefined, 'Never')).toBe('Never');
  });
});

/**
 * The shared elapsed ladder returned hardcoded English ('just now', '5m ago')
 * behind ~100 <RelativeTime> tags and 69 direct callers, so the i18n-aware
 * component rendered English in all 14 locales. It now goes through
 * Intl.RelativeTimeFormat, which needs no catalog keys.
 */
describe('formatRelativeTime', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it('walks the same rungs it always did', () => {
    expect(formatRelativeTime(ago(45_000), '-', { language: 'en' })).toBe('45 sec. ago');
    expect(formatRelativeTime(ago(5 * 60_000), '-', { language: 'en' })).toBe('5 min. ago');
    expect(formatRelativeTime(ago(2 * 3_600_000), '-', { language: 'en' })).toBe('2 hr. ago');
    expect(formatRelativeTime(ago(3 * 86_400_000), '-', { language: 'en' })).toBe('3 days ago');
  });

  it('speaks the requested language instead of English', () => {
    expect(formatRelativeTime(ago(5 * 60_000), '-', { language: 'de' })).toBe('vor 5 Min.');
    // `narrow` renders this locale as "-5 min", which is why the style is
    // `short`. Pinned so a future tightening of the style cannot regress it.
    expect(formatRelativeTime(ago(5 * 60_000), '-', { language: 'fr' })).toBe('il y a 5\u00a0min');
    expect(formatRelativeTime(ago(3 * 86_400_000), '-', { language: 'ja' })).toBe('3 日前');
  });

  it('clamps a future timestamp instead of rendering a negative count', () => {
    const future = new Date(Date.now() + 45_000).toISOString();
    expect(formatRelativeTime(future, '-', { language: 'en' })).toBe('now');
  });

  it('still returns the fallback for a missing or unparseable timestamp', () => {
    expect(formatRelativeTime(null)).toBe('-');
    expect(formatRelativeTime('not a date', 'n/a')).toBe('n/a');
  });
});

describe('formatRelativeTime date fallback', () => {
  it('renders the date fallback in the requested locale', () => {
    const then = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const iso = then.toISOString();
    const de = formatRelativeTime(iso, '-', { dateFallbackDays: 7, language: 'de' });
    const en = formatRelativeTime(iso, '-', { dateFallbackDays: 7, language: 'en-US' });
    expect(de).toBe(then.toLocaleDateString('de'));
    expect(en).toBe(then.toLocaleDateString('en-US'));
    expect(de).not.toBe(en);
  });
});

/**
 * `EXECUTION_STATUS_MAP` used to carry seven hardcoded English labels which
 * eleven call sites rendered raw, in a 14-locale app, while the i18n catalog
 * held the same enumeration for the components that went through `tokenLabel`.
 * The two lists had already drifted apart in both directions.
 */
describe('getStatusEntry', () => {
  const original = useI18nStore.getState().language;
  afterEach(() => {
    useI18nStore.setState({ language: original });
  });

  it('keeps no label in the presentation map', () => {
    for (const entry of Object.values(EXECUTION_STATUS_MAP)) {
      expect(entry).not.toHaveProperty('label');
    }
  });

  it('resolves the label for the active language', async () => {
    useI18nStore.setState({ language: 'en' });
    await preloadSectionsAsync('en', ['status_tokens']);
    expect(getStatusEntry('running').label).toBe('Running');
    expect(getStatusEntry('incomplete').label).toBe('Incomplete');
    expect(getStatusEntry('unknown').label).toBe('Unknown');

    useI18nStore.setState({ language: 'de' });
    await preloadSectionsAsync('de', ['status_tokens']);
    expect(getStatusEntry('running').label).toBe('Läuft');
    expect(getStatusEntry('incomplete').label).toBe('Unvollständig');
    expect(getStatusEntry('unknown').label).toBe('Unbekannt');
  });

  it('gives `error` its own failure badge instead of the gray Unknown one', () => {
    expect(getStatusEntry('error').icon).toBe(getStatusEntry('failed').icon);
    expect(getStatusEntry('error').text).toBe('text-status-error');
  });

  it('falls back to the gray presentation for an unmapped status', () => {
    const entry = getStatusEntry('teleported');
    expect(entry.icon).toBe(EXECUTION_STATUS_MAP.unknown!.icon);
    expect(entry.label).toBe('teleported');
  });
});

describe('formatCost', () => {
  /**
   * Regression guard. The zero case lived inside the `precision: 2` branch
   * only, so an exact 0 -- what `estimateCost` returns for every local model,
   * and what a genuinely free run costs -- fell through to the sub-threshold
   * branch at the other two precisions. The execution inspector showed
   * `$0.0000` in its Cost tile (a `<Numeric precision={4}>`) and
   * `Total: <$0.001` in the breakdown bar three lines below it.
   *
   * `<` is a claim that the value is too small to render at this precision.
   * Zero is not: it renders exactly, at every precision.
   */
  it('renders an exact zero as zero at every precision', () => {
    expect(formatCost(0, { precision: 2, language: 'en' })).toBe('$0.00');
    expect(formatCost(0, { precision: 4, language: 'en' })).toBe('$0.0000');
    expect(formatCost(0, { precision: 'auto', language: 'en' })).toBe('$0.00');
  });

  it('matches the Numeric tile it renders beside, to the digit', () => {
    // The tile composes its own currency render: a '$' glyph, then whatever
    // <Numeric precision={4}> emits for the value. Assembled here by
    // concatenation rather than as a template literal ON PURPOSE -- the
    // `$${...}` form is the census rule `hand-assembled-currency`, and this
    // test would have been its first false positive.
    const tileDigits = (0).toFixed(4);
    expect(formatCost(0, { precision: 4, language: 'en' })).toBe('$' + tileDigits);
  });

  it('still reserves the sub-threshold form for values that really are too small', () => {
    expect(formatCost(0.00004, { precision: 4, language: 'en' })).toBe('<$0.001');
    expect(formatCost(0.004, { precision: 2, language: 'en' })).toBe('<$0.01');
    expect(formatCost(0.00004, { precision: 'auto', language: 'en' })).toBe('<$0.001');
  });

  it('leaves every non-zero rendering untouched', () => {
    expect(formatCost(1.5, { precision: 2, language: 'en' })).toBe('$1.50');
    expect(formatCost(0.0042, { precision: 4, language: 'en' })).toBe('$0.0042');
    expect(formatCost(0.0042, { precision: 'auto', language: 'en' })).toBe('$0.0042');
    expect(formatCost(0.5, { precision: 'auto', language: 'en' })).toBe('$0.500');
    expect(formatCost(12, { precision: 'auto', language: 'en' })).toBe('$12.00');
  });

  it('keeps null distinct from zero', () => {
    // A cost that was never measured is not a cost of zero -- at EVERY
    // precision. The default precision (2) rendered an unmeasured cost as
    // `$0.00`, the one rendering that cannot be told apart from a genuinely
    // free run -- and the default is what the nullable callers reach
    // (CloudExecution.costUsd, CloudTriggerFiring.costUsd).
    expect(formatCost(null, { precision: 2, language: 'en' })).toBe('\u2014');
    expect(formatCost(null, { precision: 4, language: 'en' })).toBe('\u2014');
    expect(formatCost(undefined, { precision: 'auto', language: 'en' })).toBe('\u2014');
    // ...and an exact zero is still a measurement at that same precision.
    expect(formatCost(0, { precision: 2, language: 'en' })).toBe('$0.00');
  });
});
