// The decision brief's repeat case on the Kettle fixture (spark roadmap S3). Kettle already carries the ask case: kf-001
// (Member mobile app) files design/state-coverage, which the owner declined on Paper invoice to payment (kf-049), so
// its card asks and Approve stays first. This adds the repeat, in the same synthetic voice: kf-010 (strict headers on
// Book for friends & family) was filed once before on the same feature and lens and declined, so its card says
// withdraw and Decline becomes the first answer. kf-010 is ranked in store v4 (tier 1, authz), so the card also shows
// what a v4 row brings: the tier in the precedent line and the risk class in the undo line. Every row is synthetic.
import type { BlueprintData } from '../source';

/** The repeated item and the decline it repeats. */
export const BRIEF_REPEAT = { open: 'kf-010', declined: 'kf-051', note: 'Not while the CDN still strips them; ask again after the edge move.' } as const;
/** The item whose like idea was declined elsewhere (the same standard). */
export const BRIEF_ASK = { open: 'kf-001', declined: 'kf-049' } as const;

/** `data` with the repeat added (a deep copy: the caller's rows are not touched) and the store read as v4. */
export function withBriefDemo(data: BlueprintData): BlueprintData {
  const scan = structuredClone(data.scan);
  const open = scan.proposals.find((p) => p.id === BRIEF_REPEAT.open);
  if (!open) return data;
  open.tier = 1;
  open.risk_class = 'authz';
  scan.proposals.push({
    ...open,
    id: BRIEF_REPEAT.declined,
    status: 'declined',
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-08T16:20:00.000Z',
    decided_at: '2026-10-08T16:20:00.000Z',
    decided_by: 'user:owner',
    decision_note: BRIEF_REPEAT.note,
  });
  return { ...data, scan, storeVersion: 4 };
}
