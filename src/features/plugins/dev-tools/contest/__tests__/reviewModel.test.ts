import { describe, expect, it } from 'vitest';

import type { ContestPin } from '@/lib/bindings/ContestPin';

import {
  addPin,
  decisionReadiness,
  refineDeletions,
  winnerNote,
  bucketCounts,
  emptyReview,
  failureKeys,
  isReviewEmpty,
  removePin,
  seedReview,
  setBucket,
  setField,
  setNote,
  updatePin,
  variantDir,
  variantReview,
} from '../model/reviewModel';

const variants = [{ key: 'A/1' }, { key: 'A/2' }, { key: 'B/1' }];
const pin = (note: string): ContestPin => ({ xPct: 10, yPct: 20, width: 1280, height: 800, note });

describe('reviewModel', () => {
  it('builds an empty review per variant', () => {
    const r = emptyReview(variants);
    expect(r.variants.map((v) => v.key)).toEqual(['A/1', 'A/2', 'B/1']);
    expect(isReviewEmpty(r)).toBe(true);
  });

  it('never mutates its input', () => {
    const r = emptyReview(variants);
    const frozen = JSON.stringify(r);
    const next = setNote(setBucket(addPin(r, 'A/1', pin('x')), 'A/1', 'failure'), 'A/2', 'good');
    expect(JSON.stringify(r)).toBe(frozen);
    expect(next).not.toBe(r);
    expect(isReviewEmpty(next)).toBe(false);
  });

  it('keeps one winner: naming another demotes the first to the shortlist', () => {
    let r = setBucket(emptyReview(variants), 'A/1', 'winner');
    r = setBucket(r, 'B/1', 'winner');
    expect(variantReview(r, 'A/1').bucket).toBe('shortlist');
    expect(variantReview(r, 'B/1').bucket).toBe('winner');
    expect(bucketCounts(r)).toEqual({ failure: 0, impractical: 0, shortlist: 1, winner: 1 });
  });

  it('clears a bucket with null', () => {
    const r = setBucket(setBucket(emptyReview(variants), 'A/2', 'impractical'), 'A/2', null);
    expect(variantReview(r, 'A/2').bucket).toBeNull();
  });

  it('adds, edits and removes pins by index', () => {
    let r = addPin(addPin(emptyReview(variants), 'A/1', pin('one')), 'A/1', pin('two'));
    r = updatePin(r, 'A/1', 1, { note: 'second' });
    expect(variantReview(r, 'A/1').pins.map((p) => p.note)).toEqual(['one', 'second']);
    r = removePin(r, 'A/1', 0);
    expect(variantReview(r, 'A/1').pins.map((p) => p.note)).toEqual(['second']);
  });

  it('adds an entry for a key the review had not seen', () => {
    const r = setNote(emptyReview([]), 'C/3', 'late');
    expect(variantReview(r, 'C/3').note).toBe('late');
  });

  it('seeds from a saved review, completing new variants and keeping orphans', () => {
    const saved = { field: 'all', variants: [{ key: 'A/2', bucket: 'shortlist' as const, note: 'n', pins: [] }, { key: 'Z/9', bucket: null, note: 'gone', pins: [] }] };
    const r = seedReview(saved, variants);
    expect(r.field).toBe('all');
    expect(r.variants.map((v) => v.key)).toEqual(['A/1', 'A/2', 'B/1', 'Z/9']);
    expect(variantReview(r, 'A/2').bucket).toBe('shortlist');
  });

  it('lists failure keys and their arena folders', () => {
    const r = setBucket(setBucket(emptyReview(variants), 'A/1', 'failure'), 'B/1', 'failure');
    expect(failureKeys(r)).toEqual(['A/1', 'B/1']);
    expect(variantDir({ seatId: 'claude-opus_high', n: 2 })).toBe('entries/claude-opus_high/variant-2');
    const detail = {
      variants: [
        { key: 'A/1', seatId: 's1', n: 1, present: true },
        { key: 'A/2', seatId: 's1', n: 2, present: true },
        { key: 'B/1', seatId: 's2', n: 1, present: false },
      ],
    } as Parameters<typeof refineDeletions>[0];
    // Already-deleted variants are not listed again.
    expect(refineDeletions(detail, r)).toEqual(['entries/s1/variant-1']);
  });

  it('decision readiness: exactly one winner, at least one shortlisted', () => {
    let r = emptyReview(variants);
    expect(decisionReadiness(r)).toMatchObject({ canDeclare: false, canRefine: false });
    r = setBucket(r, 'A/2', 'shortlist');
    expect(decisionReadiness(r)).toMatchObject({ canDeclare: false, canRefine: true, shortlist: ['A/2'] });
    r = setBucket(r, 'B/1', 'winner');
    expect(decisionReadiness(r)).toMatchObject({ canDeclare: true, winner: 'B/1' });
  });

  it('the winner note is the owner words on the winner, else the field note', () => {
    let r = setField(emptyReview(variants), 'field words');
    expect(winnerNote(r, 'A/1')).toBe('field words');
    r = setNote(r, 'A/1', ' mine ');
    expect(winnerNote(r, 'A/1')).toBe('mine');
  });
});
