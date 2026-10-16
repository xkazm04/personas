/**
 * lensKinds - when a lens-scan product holds a Decision Center card, and which.
 *
 * Spark one-control, Stage 2, WP3. One card per product per kind, decided
 * from the `lens_scan_products` row alone (`LensScanProduct`), so the lane
 * buttons can count without reading a store:
 *
 *   build     items wait on a person's approve / decline (`proposed`), or are
 *             approved and not yet built (`approved`).
 *   evidence  built items wait on triage (`awaitingTriage`, as bp's
 *             `compare.ts awaitingTriage` over open packs).
 *   release   a release waits on the operator (its PR is open, or it merged and
 *             was never finished), or accepted items wait for one
 *             (`unreleasedAccepted`).
 *
 * A product whose store failed to open (`error` set) holds no card at all:
 * the source logs it once, quietly, and the lanes do not light for it.
 *
 * Nothing here decides a transition. The cards never write; the blueprint
 * sheet (and bp, for a release) does.
 *
 * React-free and store-free.
 */
import type { LensScanProduct } from '@/lib/bindings/LensScanProduct';

import type { DecisionKind } from '../model/decisionModel';
import { frontendLaneOf } from '../lanes/frontendLanes';

export type LensKind = 'build' | 'evidence' | 'release';

export const LENS_KINDS: readonly LensKind[] = ['build', 'evidence', 'release'];

export function isLensKind(kind: DecisionKind | string): kind is LensKind {
  return (LENS_KINDS as readonly string[]).includes(kind);
}

/** Release statuses that wait on the operator: a PR to merge, or a merge never finished (tagged). */
const RELEASE_WAITS: ReadonlySet<string> = new Set(['pr-open', 'merged']);

/** The proposal statuses a card reads. */
export type CountedStatus = 'proposed' | 'approved' | 'executing';

/**
 * The row's proposal counts, dense, for the statuses a card reads.
 *
 * Invariant that makes an absent status a zero (and not an unknown): the
 * reader answers `SELECT status, COUNT(*) FROM proposals GROUP BY status`
 * (`db/src/repos/dev/lens_scan.rs summarize`), so a status with no rows is
 * simply not in the map; and a store that could not be read carries `error`
 * instead, which yields no card before this is ever read.
 */
export function statusCounts(p: LensScanProduct): Record<CountedStatus, number> {
  const out: Record<CountedStatus, number> = { proposed: 0, approved: 0, executing: 0 };
  for (const [status, n] of Object.entries(p.counts)) {
    if (status === 'proposed' || status === 'approved' || status === 'executing') out[status] = n;
  }
  return out;
}

export function buildWaits(p: LensScanProduct): boolean {
  const c = statusCounts(p);
  return c.proposed > 0 || c.approved > 0;
}

export function evidenceWaits(p: LensScanProduct): boolean {
  return p.awaitingTriage > 0;
}

/** The open release that waits on the operator, or null. */
export function waitingRelease(p: LensScanProduct): LensScanProduct['openRelease'] | null {
  return p.openRelease && RELEASE_WAITS.has(p.openRelease.status) ? p.openRelease : null;
}

export function releaseWaits(p: LensScanProduct): boolean {
  return waitingRelease(p) !== null || p.unreleasedAccepted > 0;
}

/** The kinds this product holds a card for, in kind order. A product with a store error holds none. */
export function lensKindsOf(p: LensScanProduct): LensKind[] {
  if (p.error) return [];
  const out: LensKind[] = [];
  if (buildWaits(p)) out.push('build');
  if (evidenceWaits(p)) out.push('evidence');
  if (releaseWaits(p)) out.push('release');
  return out;
}

/** `<kind>:<projectId>`: one card per product per kind. */
export function lensItemId(kind: LensKind, projectId: string): string {
  return `${kind}:${projectId}`;
}

/** True when a lens-scan kind's fixed lane is `lane`: a surface dealing it loads the cards. */
export function lensDealsLane(lane: string | null): boolean {
  return lane !== null && LENS_KINDS.some((k) => frontendLaneOf(k)?.lane === lane);
}

/** Every card the products hold, as kinds (the lane counts place each by `frontendLanes`). */
export function lensCardKinds(products: readonly LensScanProduct[]): LensKind[] {
  return products.flatMap(lensKindsOf);
}
