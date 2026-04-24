/**
 * Unit tests for formatRelativeTime.
 *
 * Covers:
 *   - English-only fallback when `t` is omitted (pre-i18n behavior preserved).
 *   - Plural-aware i18n path when `t` is provided — uses real en.json bundle so
 *     the tests double as contract validation for the new
 *     `simple_mode.inbox.relative_*_one/other` keys.
 *   - Clock-override determinism via the `now` parameter.
 *   - Empty/unparseable timestamps render the em-dash placeholder.
 */
import { describe, it, expect } from 'vitest';

import enBundle from '@/i18n/locales/en.json';
import type { Translations } from '@/i18n/generated/types';

import { formatRelativeTime } from './formatRelativeTime';

const enT = enBundle as unknown as Translations;

/** Fixed clock for deterministic delta arithmetic. */
const NOW = Date.parse('2026-04-20T12:00:00Z');

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('formatRelativeTime', () => {
  describe('empty / unparseable', () => {
    it('null iso renders em-dash', () => {
      expect(formatRelativeTime(null)).toBe('—');
    });
    it('undefined iso renders em-dash', () => {
      expect(formatRelativeTime(undefined)).toBe('—');
    });
    it('unparseable iso falls back to the raw string (better than "NaNm ago")', () => {
      expect(formatRelativeTime('not-a-date')).toBe('not-a-date');
    });
    it('non-string input renders em-dash', () => {
      expect(formatRelativeTime(42 as unknown as string)).toBe('—');
    });
    it('future-dated iso clamps to "just now" (no "in 17 hours")', () => {
      const future = new Date(NOW + 17 * 3_600_000).toISOString();
      expect(formatRelativeTime(future, undefined, NOW)).toBe('just now');
    });
  });

  describe('English fallback (no Translations arg)', () => {
    it('< 1 minute renders "just now"', () => {
      expect(formatRelativeTime(isoAgo(30_000), undefined, NOW)).toBe('just now');
    });
    it('5 minutes old renders "5m ago"', () => {
      expect(formatRelativeTime(isoAgo(5 * 60_000), undefined, NOW)).toBe('5m ago');
    });
    it('1 minute old renders "1m ago" (singular branch still works without t)', () => {
      expect(formatRelativeTime(isoAgo(60_000), undefined, NOW)).toBe('1m ago');
    });
    it('2 hours old renders "2h ago"', () => {
      expect(formatRelativeTime(isoAgo(2 * 3_600_000), undefined, NOW)).toBe('2h ago');
    });
    it('3 days old renders "3d ago"', () => {
      expect(formatRelativeTime(isoAgo(3 * 86_400_000), undefined, NOW)).toBe('3d ago');
    });
  });

  describe('i18n path — with Translations bundle', () => {
    it('5-minute-old timestamp resolves via simple_mode.inbox.relative_minutes_other', () => {
      // Locked to the en.json key's current English copy. Translation teams
      // may diverge on non-English locales; this test guards the English
      // shape only.
      expect(formatRelativeTime(isoAgo(5 * 60_000), enT, NOW)).toBe('5m ago');
    });

    it('1-minute-old resolves via the singular `_one` key (not `_other`)', () => {
      // This test locks the plural-branch selection logic. If a future commit
      // accidentally swaps _one/_other, this catches it regardless of copy.
      const out = formatRelativeTime(isoAgo(60_000), enT, NOW);
      expect(out).toBe('1m ago');
    });

    it('< 1 minute resolves via relative_just_now key', () => {
      expect(formatRelativeTime(isoAgo(30_000), enT, NOW)).toBe('just now');
    });

    it('hours bucket interpolates {h}', () => {
      expect(formatRelativeTime(isoAgo(4 * 3_600_000), enT, NOW)).toBe('4h ago');
    });

    it('days bucket interpolates {d}', () => {
      expect(formatRelativeTime(isoAgo(10 * 86_400_000), enT, NOW)).toBe('10d ago');
    });
  });

  describe('clock-override determinism', () => {
    it('same iso + same now produces same output across calls', () => {
      const iso = isoAgo(7 * 60_000);
      const a = formatRelativeTime(iso, enT, NOW);
      const b = formatRelativeTime(iso, enT, NOW);
      expect(a).toBe(b);
      expect(a).toBe('7m ago');
    });

    it('now defaults to Date.now() when omitted — a far-future iso renders as "just now"', () => {
      // When no now override is given, `Date.now()` is used. A "future" iso
      // (negative delta) floors to < 1 minute → "just now". This test
      // pins that real-clock fallback path.
      const future = new Date(Date.now() + 10_000).toISOString();
      expect(formatRelativeTime(future, enT)).toBe('just now');
    });
  });
});
