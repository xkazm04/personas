import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { Translations } from '@/i18n/generated/types';

/**
 * One palette + one order for every fleet lifecycle state.
 *
 * The summary pills (Sessions tab), the footer status cluster and any future
 * fleet glance surface all read from here, so a state can never wear violet in
 * one place and blue in another. The colours mirror the two-axis dots in
 * `FleetStatusDots` — that component stays the source of truth for the *dot*
 * semantics; this is the source of truth for the per-state *aggregate* look.
 */

export type FleetTranslations = Translations['plugins']['fleet'];

export interface FleetStateMeta {
  id: FleetSessionState;
  /** Tailwind background class for the state dot. */
  dot: string;
  /** Tailwind text colour for a compact count chip. */
  text: string;
  /** Tailwind background tint for a compact count chip. */
  chip: string;
  /** `plugins.fleet` key for the short state label. */
  labelKey: keyof FleetTranslations;
}

/**
 * Attention-first order: the states that want a human come first, terminal
 * states last. Every consumer renders in this order, so the eye always finds
 * "needs you" in the same place.
 */
export const FLEET_STATE_META: ReadonlyArray<FleetStateMeta> = [
  { id: 'awaiting_input', dot: 'bg-violet-400',  text: 'text-violet-300',  chip: 'bg-violet-500/15',  labelKey: 'state_awaiting_input' },
  { id: 'running',        dot: 'bg-blue-400',    text: 'text-blue-300',    chip: 'bg-blue-500/15',    labelKey: 'state_working' },
  { id: 'spawning',       dot: 'bg-cyan-400',    text: 'text-cyan-300',    chip: 'bg-cyan-500/15',    labelKey: 'state_spawning' },
  { id: 'idle',           dot: 'bg-emerald-400', text: 'text-emerald-300', chip: 'bg-emerald-500/15', labelKey: 'state_idle' },
  { id: 'stale',          dot: 'bg-orange-400',  text: 'text-orange-300',  chip: 'bg-orange-500/15',  labelKey: 'state_stale' },
  { id: 'finished',       dot: 'bg-teal-400',    text: 'text-teal-300',    chip: 'bg-teal-500/15',    labelKey: 'state_finished' },
  { id: 'hibernated',     dot: 'bg-indigo-400',  text: 'text-indigo-300',  chip: 'bg-indigo-500/15',  labelKey: 'state_hibernated' },
  { id: 'exited',         dot: 'bg-zinc-500',    text: 'text-foreground',  chip: 'bg-secondary/60',   labelKey: 'state_exited' },
];

/** Zero-filled tally — every state present, so consumers never guard on undefined. */
export function emptyFleetStateCounts(): Record<FleetSessionState, number> {
  return { spawning: 0, running: 0, awaiting_input: 0, idle: 0, stale: 0, finished: 0, hibernated: 0, exited: 0 };
}

/** Count sessions per lifecycle state. */
export function fleetStateCounts(
  sessions: ReadonlyArray<{ state: FleetSessionState }>,
): Record<FleetSessionState, number> {
  const counts = emptyFleetStateCounts();
  for (const s of sessions) counts[s.state] += 1;
  return counts;
}
