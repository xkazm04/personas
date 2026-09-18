/**
 * `FrequencyEditor` already counted 5-minute collisions over the next 7 days,
 * backend-side, and then only warned — the count the product pays for had no
 * action attached to it.
 *
 * The cases that matter here are the REFUSALS. Shifting a literal minute is
 * trivial; what makes the CTA safe to put next to a cron field is that it
 * declines every expression whose minutes it cannot move without changing the
 * cadence the operator chose — a wildcard, a step, a range, or one of this
 * repo's hash-seeded `H` tokens, whose minutes the ENGINE picks. A helper that
 * "handled" those by writing a literal would silently pin a deliberately spread
 * schedule, and no test asserting only the happy path would notice.
 */
import { describe, it, expect } from 'vitest';
import { canStagger, staggerCron, STAGGER_MINUTES } from '../staggerCron';

describe('staggerCron', () => {
  it('moves a literal minute forward by the conflict window', () => {
    expect(staggerCron('0 9 * * *')).toBe('5 9 * * *');
    expect(STAGGER_MINUTES).toBe(5);
  });

  it('moves every minute of a list and keeps it sorted and deduped', () => {
    expect(staggerCron('0,30 * * * *')).toBe('5,35 * * * *');
    // 55 and 0 both land on 0/5 respectively; 25,55 -> 30,0 must sort and not
    // duplicate.
    expect(staggerCron('25,55 * * * *')).toBe('0,30 * * * *');
  });

  it('wraps inside the same hour rather than carrying into the hour field', () => {
    // Documented semantics: a stagger moves the fire within the hours the
    // expression already selects; cron's minute field cannot carry.
    expect(staggerCron('58 9 * * *')).toBe('3 9 * * *');
  });

  it('understands the seconds-first six-field form', () => {
    expect(staggerCron('0 15 9 * * *')).toBe('0 20 9 * * *');
  });

  it('refuses a wildcard, a step, or a range', () => {
    expect(staggerCron('* * * * *')).toBeNull();
    expect(staggerCron('*/5 * * * *')).toBeNull();
    expect(staggerCron('0-30 * * * *')).toBeNull();
    expect(canStagger('*/15 * * * *')).toBe(false);
  });

  it('refuses an H token — the engine owns those minutes', () => {
    expect(staggerCron('H 9 * * *')).toBeNull();
    expect(staggerCron('H/15 * * * *')).toBeNull();
  });

  it('refuses anything that is not a five- or six-field expression', () => {
    expect(staggerCron('')).toBeNull();
    expect(staggerCron('   ')).toBeNull();
    expect(staggerCron('0 9 * *')).toBeNull();
    expect(staggerCron('0 9 * * * * *')).toBeNull();
  });

  it('offers nothing when the shift would not change the expression', () => {
    expect(staggerCron('0 9 * * *', 60)).toBeNull();
    expect(staggerCron('0 9 * * *', 0)).toBeNull();
  });

  it('canStagger agrees with staggerCron on every case it gates', () => {
    for (const cron of ['0 9 * * *', '* * * * *', 'H 9 * * *', '0,30 * * * *', 'nonsense']) {
      expect(canStagger(cron)).toBe(staggerCron(cron) !== null);
    }
  });
});
