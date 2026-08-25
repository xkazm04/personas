// Publishing the Ship tab's DERIVED readings for Athena.
//
// # Why this exists
//
// `describe_ship_milestone` is authoritative about the cut and deliberately
// silent about the verdict: the exit criteria and the ship verdict derive here
// on the frontend, in `useShipData`, from signals SQLite cannot reproduce —
// this week's Sentry error count per context, which connector credentials are
// bound. A second derivation in Rust would drift from the one on the operator's
// screen, and the first time they disagreed nobody would know which was wrong.
//
// So the gap was closed the only other way available: the "Ask Athena" button
// PASTED the verdict into its opening message. That worked, and it is what made
// the message leading. A conclusion arriving before the model has read the
// milestone is a conclusion the model writes back as a finding — which is
// exactly what happened on 2026-08-24, when the answer restated the pasted
// verdict word and asked the operator to explain an objective whose description
// was sitting unread in the database.
//
// This is the third option, and the canvas already proved it: publish what we
// derived, and let the read op serve it. Same contract, same debounce, same
// dedupe as `sub_mastermind/lib/scenePublish.ts` — the difference is only in
// what is being snapshotted.
//
// The Rust contract is `SnapDoc` / `SnapMilestone` / `SnapCriterion` /
// `SnapContext` in `src-tauri/src/companion/ship_ops.rs`; the field names below
// match it exactly (camelCase, every field optional but `id`, unknown fields
// ignored). Change one side and you must change the other.
//
// Three rules this module keeps:
//   1. **Publish only what we DERIVED.** The cut, the ratings and the bound
//      goals are already in the database and the read op reads them directly.
//      Republishing them here would create a second copy that goes stale — the
//      exact defect the pasted briefing had.
//   2. **Debounce and dedupe.** `useShipData` re-derives on every data arrival.
//      An unchanged snapshot is not written at all, so the steady state costs
//      no IPC. `publishedAt` is stamped at WRITE time, never inside the compared
//      body, or it would defeat the comparison.
//   3. **Best effort.** A failed publish never breaks the tab; it clears the
//      memo so the next derive retries. The read op answers honestly when the
//      key is absent, which is the state every install starts in.
import { setAppSetting } from '@/api/system/settings';
import { silentCatch } from '@/lib/silentCatch';

import { shipVerdict, type ShipMilestoneVM } from './shipModel';

/** DB settings key — `SHIP_READINESS` in `src-tauri/db/src/settings_keys.rs`. */
export const SHIP_READINESS_KEY = 'ship.readiness.v1';

/** Snapshot document version. `load_readiness` ignores anything else. */
export const SHIP_READINESS_DOC_VERSION = 1;

/** Same window the canvas scene publisher coalesces over. */
export const PUBLISH_DEBOUNCE_MS = 500;

/** One exit criterion as Rust reads it (`ship_ops::SnapCriterion`). */
export interface ReadinessCriterion {
  label: string;
  state: string;
  evidence: string;
  done: number;
  total: number;
}

/** One footprint context as Rust reads it (`ship_ops::SnapContext`). */
export interface ReadinessContext {
  name: string;
  tone: string;
  kpis: number;
  /** Sentry errors this week. `null` = monitoring not wired — NOT zero. */
  errors: number | null;
}

/** One milestone's reading (`ship_ops::SnapMilestone`). */
export interface ReadinessMilestone {
  id: string;
  verdict: string;
  progress: number;
  criteria: ReadinessCriterion[];
  contexts: ReadinessContext[];
}

/** The published document, minus `publishedAt` (stamped at write time). */
export interface ReadinessPayload {
  version: number;
  milestones: ReadinessMilestone[];
}

/**
 * Build the snapshot body. Pure — no IPC, no timers.
 *
 * Takes the whole roadmap rather than the selected milestone: the operator
 * switches milestones constantly, and republishing a one-entry document on
 * every switch would make the dedupe useless AND leave Athena unable to answer
 * about any milestone but the one currently on screen.
 */
export function buildReadinessPayload(roadmap: ShipMilestoneVM[]): ReadinessPayload {
  return {
    version: SHIP_READINESS_DOC_VERSION,
    milestones: roadmap.map((vm) => ({
      id: vm.id,
      verdict: shipVerdict(vm.criteria),
      progress: Math.round(vm.progress),
      // Projected FIELD BY FIELD, not spread: this is a cross-language
      // contract, and `ExitCriterion.id` is a UI key Rust has no use for.
      criteria: vm.criteria.map((c) => ({
        label: c.label,
        state: c.state,
        evidence: c.evidence,
        done: c.done,
        total: c.total,
      })),
      contexts: vm.footprint.map((c) => ({
        name: c.name,
        tone: c.tone,
        kpis: c.kpis,
        errors: c.errors,
      })),
    })),
  };
}

// --- debounce + dedupe -------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
/** Serialized body of the last snapshot queued. `null` = nothing published yet
 *  (or the last write failed, so the next derive must retry). */
let lastBody: string | null = null;
let pending: ReadinessPayload | null = null;

async function writeNow(payload: ReadinessPayload): Promise<void> {
  const doc = JSON.stringify({ ...payload, publishedAt: new Date().toISOString() });
  try {
    await setAppSetting(SHIP_READINESS_KEY, doc);
  } catch (e) {
    lastBody = null;
    silentCatch('ship readiness publish')(e);
  }
}

/**
 * Queue a readiness snapshot. Idempotent by content: an unchanged roadmap
 * schedules nothing, so the steady state costs zero IPC.
 *
 * An EMPTY roadmap publishes nothing rather than an empty document — the tab
 * is still loading, and overwriting a good snapshot with an empty one would
 * make the read op say "no verdict" for every milestone until the next derive.
 */
export function publishShipReadiness(roadmap: ShipMilestoneVM[]): void {
  if (roadmap.length === 0) return;
  const payload = buildReadinessPayload(roadmap);
  const body = JSON.stringify(payload);
  if (body === lastBody) return;
  lastBody = body;
  pending = payload;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const next = pending;
    pending = null;
    if (next) void writeNow(next);
  }, PUBLISH_DEBOUNCE_MS);
}

/** Test-only reset of the module singletons (mirrors the scene publisher). */
export function __resetShipReadinessPublisherForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  lastBody = null;
  pending = null;
}
