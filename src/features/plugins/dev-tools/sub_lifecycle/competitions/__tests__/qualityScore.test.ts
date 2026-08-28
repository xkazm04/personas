import { describe, it, expect } from 'vitest';
import { computeSlotQualityScore, qualityColor, qualityBorder } from '../qualityScore';

/**
 * `computeSlotQualityScore` is the only place a competition slot's headline
 * "quality" number is produced, and CompetitionSlotRow renders it as an
 * absolute 0-100 badge with hard colour thresholds at 85 and 70. Nothing in the
 * repo asserted that the five gate weights still sum to 100, or that the colour
 * bands and the badge's own background bands agree — so a single edited weight
 * would silently redefine what "100" means while every threshold kept its old
 * number. These tests derive the maximum from the returned parts rather than
 * restating the literal 100, so they fail on a weight change instead of
 * needing one.
 */

const slot = (over: Partial<{ disqualified: boolean; diff_stats_json: string | null }> = {}) => ({
  disqualified: false,
  diff_stats_json: null as string | null,
  ...over,
});

const stats = (files: number, added: number, removed: number) =>
  JSON.stringify({ files_changed: files, lines_added: added, lines_removed: removed });

describe('computeSlotQualityScore', () => {
  it('returns null when there is no task to score', () => {
    expect(computeSlotQualityScore(null, slot())).toBeNull();
  });

  it('totals exactly the sum of its five gates', () => {
    const s = computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: stats(3, 40, 5) }));
    expect(s).not.toBeNull();
    const { total, build, tests, lint, review, completion } = s!;
    expect(build + tests + lint + review + completion).toBe(total);
  });

  it('caps a perfect slot at 100 — the scale the badge and the colour bands assume', () => {
    const best = computeSlotQualityScore(
      { status: 'completed' },
      slot({ diff_stats_json: stats(5, 120, 30) }),
    )!;
    expect(best.total).toBe(100);
    // and no reachable input beats it
    const alternatives = [
      computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: stats(2, 11, 0) }))!,
      computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: stats(1, 999, 999) }))!,
      computeSlotQualityScore({ status: 'completed' }, slot())!,
    ];
    for (const alt of alternatives) expect(alt.total).toBeLessThanOrEqual(best.total);
  });

  it('zeroes every completion-gated term for a failed task', () => {
    const s = computeSlotQualityScore({ status: 'failed' }, slot({ diff_stats_json: stats(4, 90, 10) }))!;
    expect([s.build, s.tests, s.lint, s.review, s.completion]).toEqual([0, 0, 0, 0, 0]);
    expect(s.total).toBe(0);
  });

  // REPLACES 'scores an unfinished task on completion credit alone', which
  // pinned the defect: an unfinished slot scored 5, landed under the 70
  // threshold, and rendered a RED "Q 5" pill indistinguishable from a
  // competitor that finished and failed every gate — so during a live race
  // every slot that had not finished yet wore a catastrophic badge. Every gate
  // in the rubric is post-hoc, so there is nothing to score before the slot
  // settles; the row renders the pill only when a score exists.
  it.each(['queued', 'running', 'pending', 'in_progress', 'blocked'])(
    'declines to score a %s task rather than giving it a failing grade',
    (status) => {
      expect(computeSlotQualityScore({ status }, slot())).toBeNull();
      expect(computeSlotQualityScore({ status }, slot({ diff_stats_json: stats(3, 90, 20) }))).toBeNull();
    },
  );

  it('still scores a cancelled task, which is a settled outcome', () => {
    const s = computeSlotQualityScore({ status: 'cancelled' }, slot())!;
    expect(s).not.toBeNull();
    expect(s.build).toBe(0);
    expect(s.completion).toBe(5);
    expect(s.total).toBe(5);
  });

  it('halves the tests gate for a single-file diff and drops it with no diff at all', () => {
    const many = computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: stats(2, 20, 0) }))!;
    const one = computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: stats(1, 20, 0) }))!;
    const none = computeSlotQualityScore({ status: 'completed' }, slot())!;
    expect(many.tests).toBeGreaterThan(one.tests);
    expect(one.tests).toBeGreaterThan(none.tests);
    expect(none.tests).toBe(0);
  });

  it('withholds the full review gate from a disqualified or trivial slot', () => {
    const clean = computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: stats(2, 20, 0) }))!;
    const trivial = computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: stats(2, 3, 2) }))!;
    const dq = computeSlotQualityScore(
      { status: 'completed' },
      slot({ disqualified: true, diff_stats_json: stats(2, 20, 0) }),
    )!;
    expect(clean.review).toBeGreaterThan(trivial.review);
    expect(dq.review).toBe(0);
  });

  it('survives a corrupt diff_stats_json instead of throwing', () => {
    const s = computeSlotQualityScore({ status: 'completed' }, slot({ diff_stats_json: '{not json' }))!;
    expect(s.tests).toBe(0);
    expect(s.total).toBeGreaterThan(0);
  });
});

describe('quality colour bands', () => {
  // The row renders qualityColor() for the text and its own inline background
  // ladder for the pill; both switch at 85 and 70. If the two ever disagree a
  // badge reads emerald-on-red, so pin the boundaries here.
  it('switches text colour exactly at 85 and 70', () => {
    expect(qualityColor(85)).toBe(qualityColor(100));
    expect(qualityColor(84)).not.toBe(qualityColor(85));
    expect(qualityColor(70)).toBe(qualityColor(84));
    expect(qualityColor(69)).not.toBe(qualityColor(70));
  });

  it('switches the border/background band at the same two boundaries', () => {
    expect(qualityBorder(85)).toBe(qualityBorder(100));
    expect(qualityBorder(84)).not.toBe(qualityBorder(85));
    expect(qualityBorder(70)).toBe(qualityBorder(84));
    expect(qualityBorder(69)).not.toBe(qualityBorder(70));
  });
});
