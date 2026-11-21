// PORTED from bp packages/core/src/standard/clear.ts @ 93f30b0 (spark bp-sync, WP1). Pure: no DOM, no IPC.
// EDIT (port): `blocked` is a structured ClearBlock (kind + the rule's filled reason + field labels) instead of bp's
// English sentence: pure model modules here return data and the sentence is the text hook's (useBlueprintText). This
// repo compiles with noUncheckedIndexedAccess, so indexed reads bp proves by construction carry a `!`; relative imports
// lose their .ts suffix; worseOf drops its unused manifest parameter (lint); candidates is an exhaustive switch over FieldType (see there).
// Nothing else differs from bp. Needed by cover.ts and model/ready.ts (bp imports it from both).
// What clears a lens reading: from a manifest's rules and a feature's bound values, every rule worse than the
// default that matches, each with the smallest change that stops it matching, plus the margin to the next worse
// health. Rules are first-match (health.ts matchRule), so the reason on the page names one rule; this names all of
// them. The steps are verified, not trusted: every target is applied and the rules re-run, and a list that would
// not return the default is replaced by a `blocked` reason. The manifest is the only input: nothing names a lens.
import type { ComputedHealth, Condition, LensField, LensManifest, Scalar } from './types';
import { conditionFields, evaluateCondition, fillReason } from './health';

type Values = Readonly<Record<string, Scalar | null | undefined>>;
type Leaf = Record<string, unknown> & { field: string };

/** One change: set `field` from `now` to `target` (`op` says which way a number may go further and still clear). */
export interface ClearStep { field: string; now: Scalar; target: Scalar; op: 'at most' | 'at least' | 'set to'; rule: ComputedHealth }
/** The nearest bound a numeric field would cross into a worse health, and how far it is. */
export interface WorseMargin { field: string; bound: number; health: ComputedHealth; margin: number }
/**
 * Why no verified list exists. `why` is the matched rule's reason filled with the values (manifest text, not ours);
 * labels are the manifest's field labels. bp's sentences, for the text hook:
 *   bound      '"<why>" turns on <labels joined by " and "> alone: no measured value clears it.'
 *   no-value   '"<why>" waits on <label>, which has no value to change.'
 *   no-single  'No single value of <label> clears "<why>".'
 *   needs-more 'Clearing each rule on its own still leaves it unwell: it needs more than one value changed.'
 */
export type ClearBlock =
  | { kind: 'bound'; why: string; labels: string[] }
  | { kind: 'no-value'; why: string; label: string }
  | { kind: 'no-single'; why: string; label: string }
  | { kind: 'needs-more' };
export interface ClearPath {
  /** One step (or, for an `any` rule, several) per matching unwell rule, in rule order; [] when none matches or blocked. */
  steps: ClearStep[];
  /** The margin to the next worse health; null when there is none to state (already the worst, or no numeric bound). */
  worse: WorseMargin | null;
  /** Why no verified list exists; null when the steps (or no steps) are the answer. */
  blocked: ClearBlock | null;
}

const RANK: Record<ComputedHealth, number> = { good: 0, watch: 1, bad: 2 };
const NEG: Record<string, string> = { eq: 'ne', ne: 'eq', lt: 'gte', gte: 'lt', gt: 'lte', lte: 'gt', in: 'nin', nin: 'in', missing: 'present', present: 'missing' };
const opOf = (l: Leaf): string | null => { const ks = Object.keys(l).filter((k) => k !== 'field'); return ks.length === 1 && ks[0]! in NEG ? ks[0]! : null; };
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const has = (v: Values, k: string) => Object.prototype.hasOwnProperty.call(v, k) && v[k] !== null && v[k] !== undefined;

/** A leaf that must come out `want` for a rule to stop matching. */
interface Need { leaf: Leaf; want: boolean }

/**
 * What must change for `cond` (true now) to read `want`: the leaves to flip, or null when only a feature-bound
 * field (or an operator the solver cannot steer) could do it. An `all` breaks through its first steerable leaf,
 * an `any` needs every leaf that holds; `not` flips the sense.
 */
function needs(cond: Condition, want: boolean, v: Values, bound: Set<string>): Need[] | null {
  if (evaluateCondition(cond, v) === want) return [];
  if ('not' in cond) return needs(cond.not, !want, v, bound);
  if ('all' in cond || 'any' in cond) {
    const kids = 'all' in cond ? cond.all : cond.any;
    // breaking an `all` or making an `any`: one child is enough; breaking an `any` or making an `all`: every child
    const one = ('all' in cond) !== want;
    if (one) { for (const c of kids) { const n = needs(c, want, v, bound); if (n && n.length) return n; } return null; }
    const out: Need[] = [];
    for (const c of kids) { const n = needs(c, want, v, bound); if (!n) return null; out.push(...n); }
    return out;
  }
  const leaf = cond as unknown as Leaf;
  return bound.has(leaf.field) || !opOf(leaf) ? null : [{ leaf, want }];
}

/** The values a field could take, nearest to `now` first: other enum values (last declared first), the other boolean, or the bounds' neighbours. */
function candidates(f: LensField, now: Scalar, leaves: Leaf[]): Scalar[] {
  // EDIT (port): an exhaustive switch over the declaration's FieldType (bp: an if-chain over literals; census
  // declared-field-type-literal-chain): a field type the standard adds fails to compile here instead of falling
  // silently into the last arm. Each numeric arm hands bounded() what bp read off the type.
  switch (f.type) {
    case 'boolean': return typeof now === 'boolean' ? [!now] : [true, false];
    case 'enum': return [...f.values].reverse().filter((x) => x !== now);
    case 'integer': return typeof now === 'number' ? bounded(f, now, leaves, { int: true, whole: true, lo: -Infinity, hi: Infinity }) : [];
    case 'money': return typeof now === 'number' ? bounded(f, now, leaves, { int: false, whole: true, lo: -Infinity, hi: Infinity }) : [];
    case 'percent': return typeof now === 'number' ? bounded(f, now, leaves, { int: false, whole: false, lo: 0, hi: 100 }) : [];
    case 'number': return typeof now === 'number' ? bounded(f, now, leaves, { int: false, whole: false, lo: -Infinity, hi: Infinity }) : [];
    case 'string': case 'date': return [];
  }
}

/** The bounds' neighbours for a numeric field: `int` rounds outward, `whole` steps by 1, lo / hi are the type's own range. */
function bounded(f: { min?: number; max?: number }, now: number, leaves: Leaf[], t: { int: boolean; whole: boolean; lo: number; hi: number }): number[] {
  const int = t.int, set = new Set<number>();
  for (const l of leaves) {
    const op = opOf(l), xs = op ? l[op] : undefined;
    for (const x of Array.isArray(xs) ? xs : [xs]) {
      if (typeof x !== 'number') continue;
      // the step past a bound is one the reader can see: values are shown whole from 100 (and money always), else to
      // a tenth, so a step of 0.01 under 2000 would read as the bound itself
      const e = t.whole || Math.abs(x) >= 100 ? 1 : 10 ** -Math.max(String(x).split('.')[1]?.length ?? 0, 1);
      for (const c of [x, x - e, x + e]) set.add(int ? (c < x ? Math.floor(c) : Math.ceil(c)) : round(c));
    }
  }
  const lo = f.min ?? t.lo, hi = f.max ?? t.hi;
  return [...set].filter((c) => c !== now && c >= lo && c <= hi).sort((a, b) => Math.abs(a - now) - Math.abs(b - now) || a - b);
}

/** The usable rules (a rule naming an undeclared field never matches, as in health.ts) worse than the default. */
function unwell(m: LensManifest): { rules: { when: Condition; health: ComputedHealth; reason: string }[]; known: Set<string> } {
  const known = new Set(m.fields.map((f) => f.key)), d = RANK[m.health.default];
  return { known, rules: m.health.rules.filter((r) => RANK[r.health] > d && conditionFields(r.when).every((k) => known.has(k))) };
}

/** The steps that clear every matching unwell rule, the margin to worse, or why no verified list exists. */
export function clearPath(manifest: LensManifest, values: Values): ClearPath {
  const { rules, known } = unwell(manifest);
  const F = new Map(manifest.fields.map((f) => [f.key, f] as const));
  const bound = new Set(manifest.fields.filter((f) => f.source && 'feature' in f.source).map((f) => f.key));
  const label = (k: string) => F.get(k)?.label ?? k;
  const matching = rules.filter((r) => evaluateCondition(r.when, values));
  const now: ComputedHealth = matching.reduce<ComputedHealth>((h, r) => (RANK[r.health] > RANK[h] ? r.health : h), manifest.health.default);
  const worse = worseOf(rules, values, now);
  if (!matching.length) return { steps: [], worse, blocked: null };
  const stop = (blocked: ClearBlock): ClearPath => ({ steps: [], worse, blocked });
  const steps: ClearStep[] = [];
  for (const r of matching) {
    const ns = needs(r.when, false, values, bound);
    const why = fillReason(r.reason, values);
    if (!ns || !ns.length) return stop({ kind: 'bound', why, labels: conditionFields(r.when).map(label) });
    for (const n of ns) {
      const f = F.get(n.leaf.field), cur = values[n.leaf.field];
      if (!f || cur === undefined || cur === null) return stop({ kind: 'no-value', why, label: label(n.leaf.field) });
      // the nearest value that flips this leaf and wakes no unwell rule that does not match now
      const all = rules.flatMap((x) => leavesOn(x.when, f.key));
      const ok = candidates(f, cur, all).find((c) => {
        const v = { ...values, [f.key]: c };
        return evaluateCondition(n.leaf as never, v) === n.want && rules.every((x) => matching.includes(x) || !evaluateCondition(x.when, v));
      });
      if (ok === undefined) return stop({ kind: 'no-single', why, label: label(f.key) });
      const op = typeof ok === 'number' && typeof cur === 'number' ? (ok < cur ? 'at most' : 'at least') : 'set to';
      steps.push({ field: f.key, now: cur, target: ok, op, rule: r.health });
    }
  }
  // verify: every target applied (in order) must leave no unwell rule matching and the lens still applying
  const after: Record<string, Scalar | null | undefined> = { ...values };
  for (const s of steps) after[s.field] = s.target;
  const aw = manifest.health.applies_when;
  const applies = !aw || !conditionFields(aw).every((k) => known.has(k)) || evaluateCondition(aw, after);
  if (!applies || rules.some((r) => evaluateCondition(r.when, after))) return stop({ kind: 'needs-more' });
  return { steps, worse, blocked: null };
}

function leavesOn(cond: Condition, key: string, out: Leaf[] = []): Leaf[] {
  if ('all' in cond) cond.all.forEach((c) => leavesOn(c, key, out));
  else if ('any' in cond) cond.any.forEach((c) => leavesOn(c, key, out));
  else if ('not' in cond) leavesOn(cond.not, key, out);
  else if ((cond as unknown as Leaf).field === key) out.push(cond as unknown as Leaf);
  return out;
}

/**
 * The nearest worse bound: among the rules worse than the health now that do not match, those that would match by
 * one numeric field crossing one bound (a leaf, or an `all` whose other leaves already hold); the one closest
 * relative to its bound wins. Null when the health is already the worst or no such bound exists.
 */
function worseOf(rules: ReturnType<typeof unwell>['rules'], v: Values, now: ComputedHealth): WorseMargin | null {
  let best: (WorseMargin & { rel: number }) | null = null;
  for (const r of rules) {
    if (RANK[r.health] <= RANK[now] || evaluateCondition(r.when, v)) continue;
    const kids: Condition[] = 'all' in r.when ? r.when.all : [r.when];
    const open = kids.filter((c) => !evaluateCondition(c, v));
    const one = open[0];
    if (open.length !== 1 || !one || 'all' in one || 'any' in one || 'not' in one) continue;
    const leaf = one as unknown as Leaf, op = opOf(leaf), x = op ? leaf[op] : undefined, cur = v[leaf.field];
    if (!op || !['gt', 'gte', 'lt', 'lte'].includes(op) || typeof x !== 'number' || typeof cur !== 'number' || !has(v, leaf.field)) continue;
    const margin = round(Math.abs(x - cur)), rel = margin / Math.max(Math.abs(x), 1);
    if (!best || rel < best.rel) best = { field: leaf.field, bound: x, health: r.health, margin, rel };
  }
  return best && { field: best.field, bound: best.bound, health: best.health, margin: best.margin };
}
