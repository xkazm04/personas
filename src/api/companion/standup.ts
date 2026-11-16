/**
 * Standup IPC (spark app-standup): the plan, its go-gate, away acts, the
 * forecast and the host utilisation series.
 *
 * Backend mirror: `src-tauri/src/commands/companion/standup.rs` (every
 * `standup_*` except the forecast) and `src-tauri/src/commands/fleet/host_utilization.rs`
 * (`standup_forecast`, `host_utilization_series`). Types are the ts-rs
 * bindings of `companion::standup::model` and `core::models::host_utilization`.
 * The live surface follows `standup://updated` (`EventName.STANDUP_UPDATED`)
 * and re-reads with `standupCurrent`.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { ForecastSlot } from '@/lib/bindings/ForecastSlot';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Standup } from '@/lib/bindings/Standup';
import type { StandupEvent } from '@/lib/bindings/StandupEvent';
import type { StandupItemPatch } from '@/lib/bindings/StandupItemPatch';
import type { StandupSummary } from '@/lib/bindings/StandupSummary';

/** The proposal job makes one Athena call per project, so it gets more room. */
const PROPOSE_TIMEOUT_MS = 180_000;
/** Arming amends charters and queues dispatches across every accepted item. */
const ARM_TIMEOUT_MS = 60_000;

/** The live standup (newest draft or armed revision), or null when none is open. */
export const standupCurrent = () => invoke<Standup | null>('standup_current');

/** Open a standup: revision 1, or revision n+1 copied from the armed plan. */
export const standupOpen = () => invoke<Standup>('standup_open');

/** Ask Athena for 2-4 directions per project (plus agent changes). */
export const standupPropose = (standupId: string) =>
  invoke<Standup>('standup_propose', { standupId }, { timeoutMs: PROPOSE_TIMEOUT_MS });

/** Apply one item patch (pick / edit / skip / window / priority / not-before). */
export const standupUpdateItem = (standupId: string, patch: StandupItemPatch) =>
  invoke<Standup>('standup_update_item', { standupId, patch });

/** Replace the revision's away rules. */
export const standupSetAwayRules = (standupId: string, rules: AwayRules) =>
  invoke<Standup>('standup_set_away_rules', { standupId, rules });

/** Pass the go-gate (idempotent per revision). */
export const standupArm = (standupId: string) =>
  invoke<Standup>('standup_arm', { standupId }, { timeoutMs: ARM_TIMEOUT_MS });

/** End the standup; its report becomes final. */
export const standupEnd = (standupId: string) => invoke<Standup>('standup_end', { standupId });

/** The standup's away acts, newest first. */
export const standupEvents = (standupId: string, limit: number) =>
  invoke<StandupEvent[]>('standup_events', { standupId, limit });

/** Past revisions, newest first. */
export const standupHistory = (limit: number) =>
  invoke<StandupSummary[]>('standup_history', { limit });

/** Where each plan item is expected to run on the day/night timeline. */
export const standupForecast = (standupId: string) =>
  invoke<ForecastSlot[]>('standup_forecast', { standupId });

/** Open an Athena conversation bound to one item ("Talk it through"); resolves to its id. */
export const standupDiscuss = (standupId: string, itemId: string) =>
  invoke<string>('standup_discuss', { standupId, itemId });

/** Whole-machine 1-minute rollups in `[sinceMs, untilMs)`, oldest first. */
export const hostUtilizationSeries = (sinceMs: number, untilMs: number) =>
  invoke<HostUtilizationPoint[]>('host_utilization_series', { sinceMs, untilMs });
