// PORTED from bp packages/core/src/model/ready.ts @ 93f30b0 (spark bp-sync, WP1). Pure: no DOM, no IPC, no React.
// EDIT (port): every English sentence becomes data, for the text hook: a blocked lens carries a ReadyBlock (bp's
// `why` string), a cross-lens conflict is a ReadyConflict (bp's string), and readinessLine returns ReadyPart[] (bp's
// joined line). bp's wording is quoted on each type. Imports: isCurrent / baseId from ./timeview, clearPath and
// coverStep from ../standard (clear.ts, cover.ts), scan types from src/lib/lensScan/wire.ts. `now` stays a parameter.
// Readiness for whatever the plan has selected: per feature in scope and per enabled lens, one verdict, from the lens
// manifests and readings alone (no authored criteria):
//   - clear: the lens reads good (or does not apply) on evidence no older than `maxAgeDays`;
//   - unproven: the lens reads good but its newest CURRENT reading (the scan's, or the map facet's measured_at) is
//     older than `maxAgeDays`, or nothing is measured at all. A pack's `after` reading was taken on its branch and
//     never counts (isCurrent leaves it out), so it can never make a pair clear;
//   - steps: the lens reads watch or bad and clearPath gives verified steps; each step's coverage comes from coverStep
//     (a proposal that would clear it, falls short, or none);
//   - blocked: no verified list exists (clearPath's reason, or a health held by an override no step can move).
// A cross-lens pass applies all of a feature's steps (every lens's targets at once) and re-reads every lens with the
// same evaluator: a lens that would read worse, or two lenses asking one field for incompatible targets, is a
// conflict. A feature rolls up as blocked > steps > unproven > clear. A pair whose age cannot be known (no dated
// reading anywhere, e.g. a hand-written map facet) is not called unproven: it counts as clear and is counted apart
// (`undated`), so the summary never turns "no date" into "stale". Pure; the caller computes it on a discrete change.
import type { Proposal, ScanSnapshot } from '@/lib/lensScan/wire';
import type { Feature, LensDef } from '../standard/load';
import type { Health, Scalar } from '../standard/types';
import { clearPath, type ClearBlock, type ClearStep } from '../standard/clear';
import { coverStep, type Coverage } from '../standard/cover';
import { evaluateLens } from '../standard/health';
import { baseId, isCurrent } from './timeview';

export interface ReadyOpts { maxAgeDays: number; now: string }
export interface ReadyStep { lens: string; step: ClearStep; cover: Coverage }
/**
 * Why a lens has no verified list (bp's `why`, with <name> the lens name):
 *   no-rules  '<name> has no rules to clear by.'
 *   path      '<name>: <clearPath's blocked sentence>' (ClearBlock in standard/clear.ts)
 *   no-match  '<name> reads <health>[ by an override]: no rule to clear matches.'
 */
export type ReadyBlock =
  | { kind: 'no-rules' }
  | { kind: 'path'; block: ClearBlock }
  | { kind: 'no-match'; health: 'watch' | 'bad'; override: boolean };
export type LensReady =
  | { lens: string; kind: 'clear'; newest: string | null }
  | { lens: string; kind: 'unproven'; newest: string | null; ageDays: number | null }
  | { lens: string; kind: 'steps'; steps: ReadyStep[] }
  | { lens: string; kind: 'blocked'; why: ReadyBlock };
export type ReadyKind = LensReady['kind'];
/**
 * A cross-lens conflict on one feature (lens ids; bp says them by name):
 *   clash  '<field>: <lens names joined " and "> ask for <set to X and to Y | at least LO and at most HI>: both cannot hold'
 *   worse  'Clearing <by, names joined " and "> makes <lens> <health>'
 *   still  'With every step applied <lens> still reads <health>'
 */
export type ReadyConflict =
  | { kind: 'clash'; field: string; lenses: string[]; ask: { op: 'set'; a: Scalar; b: Scalar } | { op: 'range'; lo: number; hi: number } }
  | { kind: 'worse'; lens: string; by: string[]; health: Health }
  | { kind: 'still'; lens: string; health: Health };
export interface FeatureReady { id: string; kind: ReadyKind; lenses: LensReady[]; conflicts: ReadyConflict[] }
export interface Readiness {
  features: FeatureReady[];
  n: number; clear: number; unproven: number; blocked: number; withSteps: number;
  steps: number; covered: number; short: number;
  /** Lens pairs counted clear with no dated reading anywhere (their age is unknown, not old). */
  undated: number;
  conflicts: number;
  maxAgeDays: number;
}

const DAY = 864e5;
const dayOf = (s: string | undefined | null) => (s ? s.slice(0, 10) : '');
const days = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);

/** The newest current reading per (base feature, lens) in the scan: one pass over the table. */
function newestByPair(scan: Pick<ScanSnapshot, 'measurements'> | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of scan?.measurements ?? []) {
    if (!isCurrent(m)) continue;
    const k = m.feature + '\u0000' + m.lens, d = dayOf(m.measured_at), p = out.get(k);
    if (!p || d > p) out.set(k, d);
  }
  return out;
}

const RANK: Record<string, number> = { good: 0, na: 0, watch: 1, bad: 2, unmeasured: 1 };
const KIND_RANK: Record<ReadyKind, number> = { clear: 0, unproven: 1, steps: 2, blocked: 3 };

type ReadyFeature = Pick<Feature, 'id' | 'stage' | 'lens'>;
type ReadyLens = Pick<LensDef, 'id' | 'manifest'>;

export function readiness(
  P: { lenses: readonly ReadyLens[]; F: Readonly<Record<string, ReadyFeature>> },
  scan: Pick<ScanSnapshot, 'measurements' | 'proposals'> | undefined,
  ids: Iterable<string>, opts: ReadyOpts,
  proposals: readonly Proposal[] = scan?.proposals ?? [],
): Readiness {
  const newest = newestByPair(scan);
  const r: Readiness = { features: [], n: 0, clear: 0, unproven: 0, blocked: 0, withSteps: 0, steps: 0, covered: 0, short: 0, undated: 0, conflicts: 0, maxAgeDays: opts.maxAgeDays };
  for (const id of ids) {
    const f = P.F[id]; if (!f) continue;
    const bid = baseId(f.id), lenses: LensReady[] = [];
    for (const d of P.lenses) {
      const fl = f.lens[d.id], h: Health = fl?.h ?? 'unmeasured';
      if (fl && (h === 'watch' || h === 'bad')) {
        const cp = d.manifest ? clearPath(d.manifest, fl.v) : null;
        if (!cp) { lenses.push({ lens: d.id, kind: 'blocked', why: { kind: 'no-rules' } }); continue; }
        if (cp.blocked) { lenses.push({ lens: d.id, kind: 'blocked', why: { kind: 'path', block: cp.blocked } }); continue; }
        if (!cp.steps.length) { lenses.push({ lens: d.id, kind: 'blocked', why: { kind: 'no-match', health: h, override: !!fl.ov } }); continue; }
        const steps = cp.steps.map((s) => ({ lens: d.id, step: s, cover: coverStep(s, proposals, fl.v, d.manifest, { feature: bid, lens: d.id }) }));
        lenses.push({ lens: d.id, kind: 'steps', steps });
        continue;
      }
      if (h === 'unmeasured') { lenses.push({ lens: d.id, kind: 'unproven', newest: null, ageDays: null }); continue; }
      if (h === 'na') { lenses.push({ lens: d.id, kind: 'clear', newest: null }); continue; }
      // good: fresh enough?
      const a = newest.get(bid + '\u0000' + d.id) ?? '', b = dayOf(fl?.facet?.measured_at), nw = a > b ? a : b;
      if (!nw) { r.undated++; lenses.push({ lens: d.id, kind: 'clear', newest: null }); continue; }
      const age = days(nw, opts.now);
      lenses.push(age > opts.maxAgeDays ? { lens: d.id, kind: 'unproven', newest: nw, ageDays: age } : { lens: d.id, kind: 'clear', newest: nw });
    }
    const conflicts = crossLens(P.lenses, f, lenses);
    let kind: ReadyKind = 'clear';
    for (const l of lenses) if (KIND_RANK[l.kind] > KIND_RANK[kind]) kind = l.kind;
    r.features.push({ id: f.id, kind, lenses, conflicts });
    r.n++;
    if (kind === 'clear') r.clear++; else if (kind === 'unproven') r.unproven++; else if (kind === 'blocked') r.blocked++; else r.withSteps++;
    if (conflicts.length) r.conflicts++;
    for (const l of lenses) if (l.kind === 'steps') for (const s of l.steps) {
      r.steps++;
      if (s.cover.covered && s.cover.best.verdict === 'clears') r.covered++;
      else if (s.cover.covered && s.cover.best.verdict === 'short') r.short++;
    }
  }
  return r;
}

const uniq = (xs: string[]) => [...new Set(xs)];
/**
 * Apply every lens's steps at once and re-read every lens: a lens that reads worse than now, a lens whose steps leave it
 * unwell, or one field asked for incompatible targets by two lenses.
 */
function crossLens(lenses: readonly ReadyLens[], f: ReadyFeature, verdicts: readonly LensReady[]): ReadyConflict[] {
  const all = verdicts.flatMap((v) => (v.kind === 'steps' ? v.steps : []));
  if (!all.length) return [];
  const out: ReadyConflict[] = [];
  // one field, two lenses: an "at most" below another's "at least" (or two different "set to") cannot both hold
  const byField = new Map<string, ReadyStep[]>();
  for (const s of all) { let a = byField.get(s.step.field); if (!a) byField.set(s.step.field, (a = [])); a.push(s); }
  const targets: Record<string, Scalar> = {};
  for (const [k, ss] of byField) {
    let lo = -Infinity, hi = Infinity, set: Scalar | null = null;
    let clash: Extract<ReadyConflict, { kind: 'clash' }>['ask'] | null = null;
    for (const s of ss) {
      const t = s.step.target;
      if (s.step.op === 'at most' && typeof t === 'number') hi = Math.min(hi, t);
      else if (s.step.op === 'at least' && typeof t === 'number') lo = Math.max(lo, t);
      else if (s.step.op === 'set to') { if (set !== null && set !== t) clash = { op: 'set', a: set, b: t }; set = t; }
    }
    if (lo > hi) clash = { op: 'range', lo, hi };
    if (clash) { out.push({ kind: 'clash', field: k, lenses: uniq(ss.map((s) => s.lens)), ask: clash }); continue; }
    targets[k] = set ?? (hi !== Infinity ? hi : lo);
  }
  for (const d of lenses) {
    const fl = f.lens[d.id]; if (!fl || !d.manifest?.fields) continue;
    const touched = d.manifest.fields.filter((x) => x.key in targets && !x.source);
    if (!touched.length) continue;
    const values = { ...fl.v } as Record<string, Scalar>;
    for (const x of touched) values[x.key] = targets[x.key]!;
    const before = fl.h, after = evaluateLens(d.manifest, { values }, '9999-12-31', { feature: f.stage ? { stage: f.stage } : {} }).health;
    const own = verdicts.find((v) => v.lens === d.id)?.kind === 'steps';
    if (RANK[after]! > RANK[before]!) out.push({ kind: 'worse', lens: d.id, by: uniq(all.filter((s) => s.lens !== d.id && touched.some((x) => x.key === s.step.field)).map((s) => s.lens)), health: after });
    else if (own && after !== 'good' && after !== 'na') out.push({ kind: 'still', lens: d.id, health: after });
  }
  return out;
}

/**
 * The summary line as parts, in bp's order (only the parts bp prints). bp's words, short / `long` (the callout's):
 *   clear      '<clear> of <n> clear'  /  '<n> feature(s): <clear> clear every lens'   (always present)
 *   unproven   '<n> unproven'  /  '<n> unproven (readings older than <maxAgeDays> d, or none)'
 *   steps      '<steps> step(s), <covered> covered, <short> short'
 *   blocked    '<n> blocked'
 *   conflicts  '<n> with a cross-lens conflict'   (long only)
 * joined with ' · '.
 */
export type ReadyPart =
  | { kind: 'clear'; clear: number; n: number }
  | { kind: 'unproven'; n: number; maxAgeDays: number }
  | { kind: 'steps'; steps: number; covered: number; short: number }
  | { kind: 'blocked'; n: number }
  | { kind: 'conflicts'; n: number };
export function readinessLine(r: Readiness, long = false): ReadyPart[] {
  const parts: ReadyPart[] = [{ kind: 'clear', clear: r.clear, n: r.n }];
  if (r.unproven) parts.push({ kind: 'unproven', n: r.unproven, maxAgeDays: r.maxAgeDays });
  if (r.steps) parts.push({ kind: 'steps', steps: r.steps, covered: r.covered, short: r.short });
  if (r.blocked) parts.push({ kind: 'blocked', n: r.blocked });
  if (long && r.conflicts) parts.push({ kind: 'conflicts', n: r.conflicts });
  return parts;
}
