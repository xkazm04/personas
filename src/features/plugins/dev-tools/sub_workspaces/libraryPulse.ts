// Library pulse — the workspace's weekly digest and health pillars.
//
// Both are COMPUTED VIEWS, never stored (docs/plans/workspace-knowledge-center.md
// §"projection principle": a digest is a projection over knowledge, never a
// second source of truth). Storing a weekly rollup would create a second thing
// to keep in sync with the ladder, and it would be wrong the moment a decision
// is reversed.
//
// A note on nulls: every pillar returns `null` when there is nothing to
// measure, rather than 0 (which reads as "bad") or 1 (which reads as "fine").
// The library's own `data/modeling` canon says "Never fabricate — unknown
// values stay null, gaps are reported not filled"; a health surface that
// invents a score for an empty workspace breaks the doctrine it is reporting on.
import type { KnowledgeItemView } from './libraryModel';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';

// ── digest ──────────────────────────────────────────────────────────────────

export interface Digest {
  /** ISO timestamp of the window start. */
  since: string;
  days: number;
  /** Adjudicated INTO each state inside the window (keyed on `decidedAt`). */
  adopted: KnowledgeItemView[];
  rejected: KnowledgeItemView[];
  deprecated: KnowledgeItemView[];
  /** Machine-harvested into the queue inside the window (keyed on `createdAt`). */
  harvested: KnowledgeItemView[];
  /** Everything still awaiting a decision, regardless of age — the backlog the
   *  digest is really asking you to work down. */
  pending: KnowledgeItemView[];
  /** True when nothing at all happened in the window. */
  quiet: boolean;
}

const DAY_MS = 86_400_000;

function isAfter(iso: string | null, cutoffMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= cutoffMs;
}

/** "What did this workspace decide lately?" — the Arc-3 digest. */
export function computeDigest(
  items: readonly KnowledgeItemView[],
  nowIso: string,
  days = 7,
): Digest {
  const now = Date.parse(nowIso);
  const cutoff = now - days * DAY_MS;

  const decidedIn = (status: KnowledgeItemView['status']) =>
    items.filter((i) => i.status === status && isAfter(i.decidedAt, cutoff));

  const adopted = decidedIn('adopted');
  const rejected = decidedIn('rejected');
  const deprecated = decidedIn('deprecated');
  const harvested = items.filter(
    (i) => (i.status === 'observed' || i.status === 'proposed') && isAfter(i.createdAt, cutoff),
  );
  const pending = items.filter((i) => i.status === 'observed' || i.status === 'proposed');

  return {
    since: new Date(cutoff).toISOString(),
    days,
    adopted,
    rejected,
    deprecated,
    harvested,
    pending,
    quiet:
      adopted.length === 0 &&
      rejected.length === 0 &&
      deprecated.length === 0 &&
      harvested.length === 0,
  };
}

// ── execution queue ─────────────────────────────────────────────────────────

/**
 * Cells sitting at `to_process` — adopted ACTIONABLE practices (pitfall /
 * pattern) that name work a member repo still owes.
 *
 * Adoption used to be a dead end at workspace level: the ladder recorded a
 * decision and nothing anywhere said which repos had to act on it. Seeding
 * these cells at adoption time (repos::dev_workspaces::initial_adoption_state)
 * makes that queue real; this counter is what surfaces it, and it is the hook
 * a future executor drains.
 */
export function countToProcess(
  items: readonly KnowledgeItemView[],
  adoptions: readonly WorkspacePracticeAdoption[],
): number {
  const canonIds = new Set(items.filter((i) => i.status === 'adopted').map((i) => i.id));
  return adoptions.filter((a) => a.state === 'to_process' && canonIds.has(a.practice_id)).length;
}

// ── health pillars ──────────────────────────────────────────────────────────

export type PillarKey = 'governance' | 'currency' | 'consistency' | 'liquidity';

export interface Pillar {
  key: PillarKey;
  /** 0..1, or null when there is nothing to measure. */
  score: number | null;
  /** Denominator — how many items the score is actually based on. A 100% over
   *  3 items should not read like a 100% over 300. */
  of: number;
}

export interface LibraryHealth {
  pillars: Pillar[];
  /** Mean of the pillars that could be measured; null if none could. */
  overall: number | null;
}

/** Days after which an adopted practice counts as stale canon. */
export const STALE_AFTER_DAYS = 90;

const pillar = (key: PillarKey, num: number, den: number): Pillar => ({
  key,
  score: den === 0 ? null : num / den,
  of: den,
});

/** A topic is well-formed when it is `area/cluster` and not parked in the
 *  ingest door's quarantine shelf (see db/repos/workspace_taxonomy.rs). */
export function isWellFormedTopic(topic: string): boolean {
  const parts = topic.split('/').filter(Boolean);
  return parts.length === 2 && parts[0] !== 'unsorted' && parts[1] !== 'unsorted';
}

/**
 * Four pillars over the library, each a pure function of the rows.
 *
 * - **governance** — of everything harvested, how much has a human actually
 *   ruled on? A library stuck at `observed` is a queue, not a canon.
 * - **currency** — of the adopted canon, how much has been touched inside
 *   `STALE_AFTER_DAYS`? Practices rot; the verification pass is what refreshes
 *   this.
 * - **consistency** — how much of the corpus obeys its own structure: a
 *   well-formed topic plus the categorization axes set. This is what the
 *   taxonomy work moved, and it is the pillar that silently decays every time
 *   a parallel harvest runs unconstrained.
 * - **liquidity** — of the adoption cells that could carry a practice (`na`
 *   excluded — a practice that does not apply is not illiquid), how many
 *   actually reached `adopted` in the repo? Canon adopted at workspace level
 *   but never distributed is the failure mode this whole feature exists to
 *   avoid.
 */
export function computeHealth(
  items: readonly KnowledgeItemView[],
  adoptions: readonly WorkspacePracticeAdoption[],
  nowIso: string,
  staleAfterDays = STALE_AFTER_DAYS,
): LibraryHealth {
  const now = Date.parse(nowIso);
  const freshCutoff = now - staleAfterDays * DAY_MS;

  const adjudicated = items.filter(
    (i) => i.status === 'adopted' || i.status === 'rejected' || i.status === 'deprecated',
  );
  const canon = items.filter((i) => i.status === 'adopted');
  const fresh = canon.filter((i) => isAfter(i.updatedAt, freshCutoff));

  // Consistency is judged over live rows only — rejected items are kept as
  // dedup memory ("rejection is knowledge"), and holding them to the current
  // structure would penalize the library for remembering.
  const live = items.filter((i) => i.status !== 'rejected');
  const structured = live.filter(
    (i) => isWellFormedTopic(i.topic) && i.abstraction !== null && i.ftype !== null,
  );

  const canonIds = new Set(canon.map((i) => i.id));
  const cells = adoptions.filter((a) => canonIds.has(a.practice_id) && a.state !== 'na');
  const landed = cells.filter((a) => a.state === 'adopted');

  const pillars: Pillar[] = [
    pillar('governance', adjudicated.length, items.length),
    pillar('currency', fresh.length, canon.length),
    pillar('consistency', structured.length, live.length),
    pillar('liquidity', landed.length, cells.length),
  ];

  const measured = pillars.filter((p): p is Pillar & { score: number } => p.score !== null);
  return {
    pillars,
    overall: measured.length
      ? measured.reduce((sum, p) => sum + p.score, 0) / measured.length
      : null,
  };
}
