// What is actually WORKING on a project right now, reduced to the buckets the
// far-zoom island paints on its hex border. Pure — no React, no store.
//
// The far band answers one question and no others: "is anything happening
// here?". Readiness, wiring and KPIs are all mid/near/close concerns (and the
// island's halo still carries readiness colour underneath), so the only inputs
// here are the two live LLM-operation lanes the canvas already tracks — Fleet
// CLI sessions and personas with an execution in progress.
import { FLEET_STATE_ORDER } from './fleetMeta';
import { FLEET_INK } from './ink';
import type { FleetNode } from './types';

/** Persona lane ink — the same token FleetBadges paints its persona pill with,
 *  so the two surfaces agree on what "a persona is working" looks like. */
export const PERSONA_INK = 'var(--status-processing)';

/** A session that has EXITED is not development running behind a project. The
 *  page already strips exited sessions for real projects; demo islands carry
 *  their own fixture fleet, so the filter lives here too rather than relying on
 *  the caller — "3 running" must never be counting something that finished. */
const DEAD_STATES = new Set(['exited']);

export interface ProcessBucket {
  /** Fleet state token, or the literal `personas` for the persona lane. */
  key: string;
  kind: 'fleet' | 'persona';
  count: number;
  /** Theme-token colour for this bucket's border arc. */
  ink: string;
}

/**
 * Live processes behind one island, grouped for the border encoding.
 *
 * Ordered attention-worthy-first (FLEET_STATE_ORDER: awaiting_input, running,
 * spawning, …) with the persona lane last, so the first arc drawn — and the
 * colour the hex body is tinted with — is always the one the operator most
 * needs to see. Fleet states outside the known order are kept rather than
 * dropped: an unrecognised state is still a running thing, and silently
 * omitting it would make the number lie.
 */
export function processBuckets(fleet: readonly FleetNode[], personas: readonly string[]): ProcessBucket[] {
  const counts = new Map<string, number>();
  for (const f of fleet) {
    if (DEAD_STATES.has(f.state)) continue;
    counts.set(f.state, (counts.get(f.state) ?? 0) + 1);
  }
  const known = FLEET_STATE_ORDER as readonly string[];
  const ordered = [
    ...known.filter((s) => counts.has(s)),
    ...[...counts.keys()].filter((s) => !known.includes(s)).sort(),
  ];
  const buckets: ProcessBucket[] = ordered.map((state) => ({
    key: state,
    kind: 'fleet' as const,
    count: counts.get(state)!,
    ink: FLEET_INK[state] ?? 'var(--status-neutral)',
  }));
  if (personas.length > 0) {
    buckets.push({ key: 'personas', kind: 'persona', count: personas.length, ink: PERSONA_INK });
  }
  return buckets;
}

/** Total live processes — the number the far-zoom hex fills itself with. */
export function processTotal(buckets: readonly ProcessBucket[]): number {
  let n = 0;
  for (const b of buckets) n += b.count;
  return n;
}
