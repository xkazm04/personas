import type { UnlistenFn } from '@tauri-apps/api/event';

import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { CharterActFilter } from '@/lib/bindings/CharterActFilter';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import type { GoalMetWhen } from '@/lib/bindings/GoalMetWhen';
import type { MandateActOutcome } from '@/lib/bindings/MandateActOutcome';
import type { MandateChange } from '@/lib/bindings/MandateChange';
import type { MandateSignInput } from '@/lib/bindings/MandateSignInput';
import type { MandateScopes } from '@/lib/bindings/MandateScopes';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { OrphanClusters } from '@/lib/bindings/OrphanClusters';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { invokeWithTimeout } from '@/lib/tauriInvoke';

// Mandate envelope + act log IPC (spark mandate-lanes, WP2). The Rust side is
// `commands/core/mandates.rs`; storage and the one-transaction envelope doors
// are `db/repos/core/mandates.rs`. Every door returns the refreshed mandate and
// the act it wrote, and announces the act on `charter-act-recorded`.

/** Every mandate that is not retired, with its envelope and load (spend, acts, open asks). */
export const listMandates = () => invokeWithTimeout<MandateSummary[]>('mandate_list');

/** One mandate by charter id (any status). */
export const getMandate = (id: string) => invokeWithTimeout<MandateSummary>('mandate_get', { id });

/** Sign the whole envelope. Activates a draft; bumps the envelope version. */
export const signMandate = (id: string, envelope: MandateSignInput) =>
  invokeWithTimeout<MandateActOutcome>('mandate_sign', { id, envelope });

/** Widen or narrow the scopes, or set the merge policy or the budget, of a signed envelope. */
export const amendMandate = (id: string, change: MandateChange) =>
  invokeWithTimeout<MandateActOutcome>('mandate_amend', { id, change });

export const suspendMandate = (id: string) =>
  invokeWithTimeout<MandateActOutcome>('mandate_suspend', { id });

export const resumeMandate = (id: string) =>
  invokeWithTimeout<MandateActOutcome>('mandate_resume', { id });

/**
 * Drop a DRAFT mandate with the operator's reason (WP6): the charter is
 * retired and one final act records the reason. Anything else is refused
 * (`validation`).
 */
export const dropMandate = (id: string, reason: string | null) =>
  invokeWithTimeout<MandateActOutcome>('mandate_drop', { id, reason });

/**
 * Keep a signed mandate as signed after a re-read (WP6): the re-read marker
 * moves to the acts it holds now, so the re-read returns only when its use has
 * grown past them. `reason` is the re-read code that was answered.
 */
export const keepMandate = (id: string, reason: string) =>
  invokeWithTimeout<MandateActOutcome>('mandate_keep', { id, reason });

/** The conditions a goal names for "met" (`dev_goals.met_when`); `metWhen: null` = none set. */
export const getGoalMetWhen = (goalId: string) =>
  invokeWithTimeout<GoalMetWhen>('goal_met_when', { goalId });

/**
 * One mandate's Scopes section (WP6): per scope its acts, or how many of the
 * asks reaching you now it would absorb (counted through the router, with the
 * items), plus the merge and spend rows. `arms` says which widen arms twice.
 * Widen and narrow go through `amendMandate`.
 */
export const getMandateScopes = (id: string) =>
  invokeWithTimeout<MandateScopes>('mandate_scopes', { id });

/** The orphanage: pending items no mandate holds, per project, against the fleet's flow. */
export const listOrphanClusters = () => invokeWithTimeout<OrphanClusters>('orphan_clusters');

/**
 * Draft a mandate for an orphaned project (a Sign card follows). `steward`
 * names the persona when the orphanage found none; refused (`validation`)
 * when the project already has a live mandate.
 */
export const draftOrphanMandate = (projectId: string, steward: string | null) =>
  invokeWithTimeout<MandateActOutcome>('orphan_draft', { projectId, steward });

/** Adopt an orphaned project into an existing mandate (its steward and envelope). */
export const adoptOrphans = (projectId: string, charterId: string) =>
  invokeWithTimeout<MandateActOutcome>('orphan_adopt', { projectId, charterId });

/** Archive a project's orphans from the Orphans lane (not deleted). Resolves the count archived. */
export const archiveOrphans = (projectId: string) =>
  invokeWithTimeout<number>('orphan_archive', { projectId });

/** Acts matching the filter, newest first (default 100, capped at 500). */
export const listCharterActs = (filter?: CharterActFilter) =>
  invokeWithTimeout<CharterAct[]>('charter_acts_list', { filter: filter ?? null });

/**
 * Revert one act. An irreversible act is refused with error kind `forbidden`;
 * an already reverted or superseded one with `validation`. A router act's
 * source row is restored first (report unread, incident reopened).
 */
export const revertCharterAct = (id: string) =>
  invokeWithTimeout<MandateActOutcome>('charter_act_revert', { id });

/**
 * Every pending decision item's lane, clause, charter and coalesce key, as the
 * Rust router computes it (WP3). Join on `itemId` (= `DecisionItem.id`). A
 * source in `failedSources` failed to load: render it failed, never 0.
 * Build questions and chat threads are not in it (frontend-derived kinds).
 */
export const getDecisionLanesSnapshot = () =>
  invokeWithTimeout<DecisionLanesSnapshot>('decision_lanes_snapshot');

/** Follow every recorded act (decisions, envelope changes, reverts). */
export function listenCharterActs(handler: (act: CharterAct) => void): Promise<UnlistenFn> {
  return typedListen(EventName.CHARTER_ACT_RECORDED, handler);
}
