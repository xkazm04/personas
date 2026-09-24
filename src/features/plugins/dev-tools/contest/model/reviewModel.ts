// The owner's review, as immutable operations.
//
// `ContestReview` is what `contest_save_review` writes to review.json and what
// REVIEW.md is rendered from (Rust `render_review_markdown`). Every op returns
// a NEW review and never mutates its input: the autosave compares drafts by
// reference, so an in-place edit would read as "nothing changed" and be lost.
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestPin } from '@/lib/bindings/ContestPin';
import type { ContestReview } from '@/lib/bindings/ContestReview';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';
import type { ContestVariantReview } from '@/lib/bindings/ContestVariantReview';

export const REVIEW_BUCKETS: readonly ContestReviewBucket[] = ['failure', 'impractical', 'shortlist', 'winner'];

export function emptyVariantReview(key: string): ContestVariantReview {
  return { key, bucket: null, note: '', pins: [] };
}

/** A blank review with one entry per variant, in manifest order. */
export function emptyReview(variants: readonly Pick<ContestVariant, 'key'>[]): ContestReview {
  return { field: '', variants: variants.map((v) => emptyVariantReview(v.key)) };
}

/** The saved review completed with an entry for every variant the manifest
 *  now carries (a re-collect can add variants the saved review never saw). */
export function seedReview(
  saved: ContestReview | null,
  variants: readonly Pick<ContestVariant, 'key'>[],
): ContestReview {
  if (!saved) return emptyReview(variants);
  const byKey = new Map(saved.variants.map((v) => [v.key, v]));
  const ordered = variants.map((v) => byKey.get(v.key) ?? emptyVariantReview(v.key));
  const known = new Set(variants.map((v) => v.key));
  // Reviewed variants the manifest no longer lists keep their review — the
  // backend validates keys, and dropping the owner's words silently is worse.
  const orphans = saved.variants.filter((v) => !known.has(v.key));
  return { field: saved.field, variants: [...ordered, ...orphans] };
}

export function variantReview(review: ContestReview, key: string): ContestVariantReview {
  return review.variants.find((v) => v.key === key) ?? emptyVariantReview(key);
}

function patchVariant(
  review: ContestReview,
  key: string,
  patch: (v: ContestVariantReview) => ContestVariantReview,
): ContestReview {
  let found = false;
  const variants = review.variants.map((v) => {
    if (v.key !== key) return v;
    found = true;
    return patch(v);
  });
  if (!found) variants.push(patch(emptyVariantReview(key)));
  return { ...review, variants };
}

/** Sort a variant into a tray; `null` clears it. The winner tray holds ONE
 *  variant, so naming a new winner moves the previous one to the shortlist. */
export function setBucket(review: ContestReview, key: string, bucket: ContestReviewBucket | null): ContestReview {
  const demoted =
    bucket === 'winner'
      ? {
          ...review,
          variants: review.variants.map((v) =>
            v.key !== key && v.bucket === 'winner' ? { ...v, bucket: 'shortlist' as const } : v,
          ),
        }
      : review;
  return patchVariant(demoted, key, (v) => ({ ...v, bucket }));
}

export function setNote(review: ContestReview, key: string, note: string): ContestReview {
  return patchVariant(review, key, (v) => ({ ...v, note }));
}

export function addPin(review: ContestReview, key: string, pin: ContestPin): ContestReview {
  return patchVariant(review, key, (v) => ({ ...v, pins: [...v.pins, pin] }));
}

export function updatePin(review: ContestReview, key: string, index: number, patch: Partial<ContestPin>): ContestReview {
  return patchVariant(review, key, (v) => ({
    ...v,
    pins: v.pins.map((p, i) => (i === index ? { ...p, ...patch } : p)),
  }));
}

export function removePin(review: ContestReview, key: string, index: number): ContestReview {
  return patchVariant(review, key, (v) => ({ ...v, pins: v.pins.filter((_, i) => i !== index) }));
}

/** The `## All` whole-field note. */
export function setField(review: ContestReview, field: string): ContestReview {
  return { ...review, field };
}

export function bucketCounts(review: ContestReview): Record<ContestReviewBucket, number> {
  const counts: Record<ContestReviewBucket, number> = { failure: 0, impractical: 0, shortlist: 0, winner: 0 };
  for (const v of review.variants) if (v.bucket) counts[v.bucket] += 1;
  return counts;
}

export function keysInBucket(review: ContestReview, bucket: ContestReviewBucket): string[] {
  return review.variants.filter((v) => v.bucket === bucket).map((v) => v.key);
}

/** The variants a refine decision deletes from disk. */
export function failureKeys(review: ContestReview): string[] {
  return keysInBucket(review, 'failure');
}

/** Where a variant lives in the arena — what the delete confirmation names. */
export function variantDir(variant: Pick<ContestVariant, 'seatId' | 'n'>): string {
  return `entries/${variant.seatId}/variant-${variant.n}`;
}

/** Whether the review has anything the owner wrote. */
export function isReviewEmpty(review: ContestReview): boolean {
  return (
    review.field.trim() === '' &&
    review.variants.every((v) => v.bucket === null && v.note.trim() === '' && v.pins.length === 0)
  );
}

/** What each decision needs, from the review alone. The DecisionBar's gate. */
export function decisionReadiness(review: ContestReview) {
  const winners = keysInBucket(review, 'winner');
  const shortlist = keysInBucket(review, 'shortlist');
  return {
    winner: winners.length === 1 ? winners[0]! : null,
    canDeclare: winners.length === 1,
    shortlist,
    canRefine: shortlist.length > 0,
  };
}

/** The winner's note: the owner's words on the winning variant, else the
 *  whole-field note. */
export function winnerNote(review: ContestReview, key: string): string {
  const own = variantReview(review, key).note.trim();
  return own || review.field.trim();
}

/** The variant folders a refine deletes (failure tray), as arena paths. */
export function refineDeletions(detail: Pick<ContestDetail, 'variants'>, review: ContestReview): string[] {
  const doomed = new Set(failureKeys(review));
  return detail.variants.filter((v) => doomed.has(v.key) && v.present).map(variantDir);
}
