// Seat specs — the one grammar the app shares with the /contest skill.
//
// A seat is `engine:model@effort[#label]`. The parse regex and the id rule are
// transcribed from the skill's `parseParticipant` (ai-registry
// skills/contest/scripts/lib/participants.mjs), because the id names a folder
// on disk (`entries/<seatId>`) that both the CLI and the app must agree on.
// If the skill changes either, this file changes in the same breath.
import type { ContestEffort } from '@/lib/bindings/ContestEffort';
import type { ContestEngine } from '@/lib/bindings/ContestEngine';
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';

export const CONTEST_ENGINES: readonly ContestEngine[] = ['claude', 'codex', 'grok'];

export const CONTEST_EFFORTS: readonly ContestEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The click grid's models per engine. Any other model id is typed into the
 *  engine's free-text field — the catalog is a shortcut, not a whitelist. */
export const CONTEST_MODEL_CATALOG: Readonly<Record<ContestEngine, readonly string[]>> = {
  claude: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5'],
  codex: ['gpt-6-sol', 'gpt-6-astra'],
  grok: ['grok-4.6'],
};

/** The effort a freshly clicked seat starts at. */
export const DEFAULT_SEAT_EFFORT: ContestEffort = 'high';

/** Mirrors participants.mjs `parseParticipant`. */
const SPEC_RE = /^([a-z]+):([A-Za-z0-9._-]+)@([a-z]+)(?:#([A-Za-z0-9._-]+))?$/;

/** A model id or a label: what the skill's regex accepts in those slots. */
const TOKEN_RE = /^[A-Za-z0-9._-]+$/;

export function isContestEngine(v: string): v is ContestEngine {
  return (CONTEST_ENGINES as readonly string[]).includes(v);
}

export function isContestEffort(v: string): v is ContestEffort {
  return (CONTEST_EFFORTS as readonly string[]).includes(v);
}

/** True when `v` is legal in the model or label slot of a spec. */
export function isSpecToken(v: string): boolean {
  return TOKEN_RE.test(v);
}

/** `engine:model@effort[#label]`. */
export function formatSeatSpec(spec: ContestSeatSpec): string {
  return `${spec.engine}:${spec.model}@${spec.effort}${spec.label ? `#${spec.label}` : ''}`;
}

/** The structured spec, or null when the string is not a legal seat. */
export function parseSeatSpec(raw: string): ContestSeatSpec | null {
  const m = raw.trim().match(SPEC_RE);
  if (!m) return null;
  const [, engine, model, effort, label] = m;
  if (!engine || !model || !effort) return null;
  if (!isContestEngine(engine) || !isContestEffort(effort)) return null;
  return { engine, model, effort, label: label ?? null };
}

/** The seat's folder id — the skill's rule, character for character. */
export function seatId(spec: ContestSeatSpec): string {
  return `${spec.engine}-${spec.model}_${spec.effort}${spec.label ? `-${spec.label}` : ''}`.replace(
    /[^A-Za-z0-9._-]/g,
    '_',
  );
}

/** Ids that occur more than once. The skill refuses such a panel ("add #label
 *  to run the same seat twice"), so the form refuses it first. */
export function duplicateSeatIds(specs: readonly ContestSeatSpec[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of specs) {
    const id = seatId(s);
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

/** Specs from a saved line-up; strings that no longer parse are dropped and
 *  counted so the picker can say so instead of silently shrinking the panel. */
export function specsFromLineup(seats: readonly string[]): { specs: ContestSeatSpec[]; dropped: number } {
  const specs: ContestSeatSpec[] = [];
  let dropped = 0;
  for (const raw of seats) {
    const s = parseSeatSpec(raw);
    if (s) specs.push(s);
    else dropped += 1;
  }
  return { specs, dropped };
}

/** Two specs name the same seat (same folder id). */
export function sameSeat(a: ContestSeatSpec, b: ContestSeatSpec): boolean {
  return seatId(a) === seatId(b);
}

/** Add `spec`, labelling it `2`, `3`, … when the same seat is already on the
 *  panel (the skill refuses a duplicate seat without a label). */
export function addSeat(panel: readonly ContestSeatSpec[], spec: ContestSeatSpec): ContestSeatSpec[] {
  const ids = new Set(panel.map(seatId));
  if (!ids.has(seatId(spec))) return [...panel, spec];
  for (let n = 2; ; n += 1) {
    const labelled = { ...spec, label: String(n) };
    if (!ids.has(seatId(labelled))) return [...panel, labelled];
  }
}
