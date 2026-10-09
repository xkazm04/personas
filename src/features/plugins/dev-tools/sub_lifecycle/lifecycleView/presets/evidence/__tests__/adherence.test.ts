import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { commitHistory, landHistory } from '../../../../journey/__tests__/evidenceFixtures';
import { adherence, CHANGES_PER_BUCKET, doneRate, localDay, MAX_WEEKS, mondayOf, type OffsetOf } from '../adherence';

const UTC: OffsetOf = () => 0;
const PRAGUE_SUMMER: OffsetOf = () => -120; // UTC+2
const NEW_YORK: OffsetOf = () => 240; // UTC-4

const at = (iso: string, outcome: LifecycleOutcome = 'done') => ({ outcome, occurredAt: iso });
const inputsOf = (items: ReturnType<typeof landHistory>) => items.map((e) => ({ outcome: e.outcomes[0]!.outcome, occurredAt: e.occurredAt }));

describe('adherence: the done rate per week', () => {
  it('starts weeks on Monday at local midnight, whatever the zone', () => {
    // 2026-10-04 is a Sunday, 2026-10-05 a Monday.
    const late = Date.parse('2026-10-04T23:30:00Z');
    expect(mondayOf(localDay(late, UTC))).toBe(localDay(Date.parse('2026-09-28T12:00:00Z'), UTC));
    // In Prague it is already Monday 01:30: a new week.
    expect(mondayOf(localDay(late, PRAGUE_SUMMER))).toBe(localDay(Date.parse('2026-10-05T12:00:00Z'), UTC));
    // In New York it is Sunday 19:30: still the old week.
    expect(mondayOf(localDay(late, NEW_YORK))).toBe(localDay(Date.parse('2026-09-28T12:00:00Z'), UTC));
  });

  it('a change just past midnight moves to the next week only in the zone where it is past midnight', () => {
    const inputs = [
      at('2026-10-04T23:30:00Z', 'skipped'),
      ...Array.from({ length: 6 }, (_, i) => at(`2026-09-${String(10 + i).padStart(2, '0')}T12:00:00Z`)),
    ];
    const utc = adherence(inputs, { minSamples: 1, offsetOf: UTC });
    const prague = adherence(inputs, { minSamples: 1, offsetOf: PRAGUE_SUMMER });
    expect(utc.mode).toBe('week');
    expect(utc.buckets.at(-1)!.skipped).toBe(1);
    expect(prague.buckets.at(-1)!.fromDay).toBe(utc.buckets.at(-1)!.fromDay + 7);
    expect(prague.buckets.at(-1)!.skipped).toBe(1);
  });

  it('keeps empty weeks as slots, and extends to the current week', () => {
    const inputs = [at('2026-09-30T12:00:00Z'), at('2026-09-01T12:00:00Z')];
    const s = adherence(inputs, { minSamples: 1, offsetOf: UTC, now: Date.parse('2026-10-14T12:00:00Z') });
    expect(s.mode).toBe('week');
    // Aug 31 .. Oct 12: seven Mondays.
    expect(s.buckets).toHaveLength(7);
    expect(s.buckets.filter((b) => b.n === 0)).toHaveLength(5);
    expect(s.buckets.at(-1)).toMatchObject({ n: 0, ratePct: null, judged: false });
  });

  it('judges a week only from minSamples changes; fewer is a hint (judged false), and unknown is not counted', () => {
    const week = (day: number, o: LifecycleOutcome) => at(`2026-09-${String(day).padStart(2, '0')}T12:00:00Z`, o);
    const inputs = [
      week(30, 'done'), week(29, 'skipped'), week(29, 'unknown'),
      ...[21, 22, 23, 24, 25].map((d) => week(d, d === 25 ? 'failed' : 'done')),
      week(1, 'done'),
    ];
    const s = adherence(inputs, { minSamples: 5, offsetOf: UTC });
    const last = s.buckets.at(-1)!;
    expect(last).toMatchObject({ done: 1, skipped: 1, unknown: 1, n: 2, ratePct: 50, judged: false });
    expect(s.buckets.at(-2)).toMatchObject({ done: 4, failed: 1, n: 5, ratePct: 80, judged: true });
  });

  it(`keeps the newest ${MAX_WEEKS} weeks and says how many it dropped`, () => {
    const inputs = Array.from({ length: 40 }, (_, i) => at(new Date(Date.parse('2026-10-07T12:00:00Z') - i * 7 * 86_400_000).toISOString()));
    const s = adherence(inputs, { minSamples: 1, offsetOf: UTC });
    expect(s.buckets).toHaveLength(MAX_WEEKS);
    expect(s.clipped).toBe(14);
  });

  it('the fixtures: Land spans about nine weeks; Commit has a dip week', () => {
    const land = adherence(inputsOf(landHistory()), { minSamples: 5, offsetOf: UTC });
    expect(land.mode).toBe('week');
    expect(land.buckets.length).toBeGreaterThanOrEqual(9);
    const commit = adherence(inputsOf(commitHistory()), { minSamples: 5, offsetOf: UTC });
    const rates = commit.buckets.filter((b) => b.judged).map((b) => b.ratePct!);
    expect(Math.min(...rates)).toBeLessThan(80);
    expect(rates.filter((r) => r >= 80).length).toBeGreaterThanOrEqual(2);
  });
});

describe('adherence: short records go per ten changes', () => {
  it('counts back from the newest change, so the newest bucket is full and the oldest short', () => {
    const inputs = Array.from({ length: 23 }, (_, i) => at(new Date(Date.parse('2026-10-08T12:00:00Z') - i * 3_600_000).toISOString(), i < 10 ? 'done' : 'skipped'));
    const s = adherence(inputs, { minSamples: 5, offsetOf: UTC });
    expect(s.mode).toBe('changes');
    expect(s.buckets.map((b) => b.n)).toEqual([3, CHANGES_PER_BUCKET, CHANGES_PER_BUCKET]);
    expect(s.buckets.at(-1)).toMatchObject({ ratePct: 100, judged: true });
    expect(s.buckets[0]).toMatchObject({ judged: false });
    expect(s.buckets.map((b) => b.key)).toEqual([0, 1, 2]);
  });

  it('drops unknown outcomes and draws nothing for no changes', () => {
    expect(adherence([], { minSamples: 5 }).buckets).toEqual([]);
    const s = adherence([at('2026-10-08T10:00:00Z', 'unknown'), at('2026-10-08T09:00:00Z')], { minSamples: 1, offsetOf: UTC });
    expect(s.buckets).toHaveLength(1);
    expect(s.buckets[0]).toMatchObject({ n: 1, done: 1 });
  });
});

describe('the done rate is the backend rule', () => {
  it('matches health.rs evidence_step: done / (done + skipped + failed), unknown not counted', () => {
    const rust = readFileSync(resolve(__dirname, '../../../../../../../../../src-tauri/src/lifecycle/health.rs'), 'utf8');
    const body = rust.slice(rust.indexOf('fn evidence_step'), rust.indexOf('fn evidence_step') + 600);
    expect(body).toContain('let counted = t.done + t.skipped + t.failed;');
    expect(body).toContain('t.done as f64 * 100.0 / counted as f64');
    expect(body).toContain('samples < MIN_SAMPLES');
    expect(doneRate({ done: 3, skipped: 1, failed: 0 })).toEqual({ n: 4, ratePct: 75 });
    expect(doneRate({ done: 0, skipped: 0, failed: 0 })).toEqual({ n: 0, ratePct: null });
  });
});
