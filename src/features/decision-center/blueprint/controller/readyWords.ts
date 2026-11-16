// PORTED from bp apps/web/src/components/sheet/LensPanel.tsx @ 93f30b0 (CoverChip, ClearSteps' step line) and
// apps/web/src/components/Overlays.tsx @ 93f30b0 (the readiness callout's coverWord and row lines).
// EDIT (port): bp builds these sentences inline in English; here they are the words of t.decisionCenter.blueprint
// (`sync_*`) for the structured data WP1's pure models return (standard/clear ClearBlock, standard/cover Coverage,
// model/ready ReadyBlock / ReadyConflict / ReadyPart). Values are formatted through ui/page/values fmtValue in the
// app's language; lists are joined with Intl.ListFormat ("A and B"). bp's raw `field op target (now x)` in the callout
// reads the field's label and formatted values here, the same step line the lens tab shows.
import type { ClearBlock, ClearStep, WorseMargin } from '../standard/clear';
import type { Coverage } from '../standard/cover';
import type { LensDef } from '../standard/load';
import type { Health, LensField, Scalar } from '../standard/types';
import type { ReadyBlock, ReadyConflict, ReadyPart } from '../model/ready';
import { fmtValue } from '../ui/page/values';
import { statusWord } from '../ui/StatusChip';
import { type BlueprintText, verdictWord } from './useBlueprintText';

type Lenses = Readonly<Record<string, Pick<LensDef, 'name' | 'F'>>>;

const lower = (s: string) => s.toLowerCase();
/** "A and B" / "A, B and C" in the app's language. */
export function andList(language: string, xs: readonly string[]): string {
  try { return new Intl.ListFormat(language, { type: 'conjunction' }).format(xs); } catch { return xs.join(', '); }
}

/** A step value: the field's own formatting when the manifest declares it, else as read. */
export function stepValue({ B, language }: BlueprintText, x: LensField | undefined, v: Scalar | number): string {
  return x ? fmtValue(language, x, v, { yes: B.pg_yes, no: B.pg_no }) : String(v);
}

/** One clear step: "Monthly cost: $2,100 → at most $1,999" (bp `label: now → op target`). */
export function stepText(text: BlueprintText, x: LensField | undefined, s: ClearStep): string {
  const { B, tx } = text, args = { label: x?.label ?? s.field, now: stepValue(text, x, s.now), target: stepValue(text, x, s.target) };
  return tx(s.op === 'at most' ? B.sync_clr_most : s.op === 'at least' ? B.sync_clr_least : B.sync_clr_set, args);
}

/** "clears bad" / "clears watch" beside a step. */
export const clearsText = ({ B, tx }: BlueprintText, h: Health): string => tx(B.sync_clr_clears, { health: lower(verdictWord(B, h)) });

/** Why no verified list exists (standard/clear ClearBlock, bp's sentences). */
export function blockText({ B, tx, language }: BlueprintText, b: ClearBlock): string {
  switch (b.kind) {
    case 'bound': return tx(B.sync_blk_bound, { why: b.why, labels: andList(language, b.labels) });
    case 'no-value': return tx(B.sync_blk_no_value, { why: b.why, label: b.label });
    case 'no-single': return tx(B.sync_blk_no_single, { why: b.why, label: b.label });
    case 'needs-more': return B.sync_blk_needs_more;
  }
}

/** The margin to the next worse health: "Monthly cost is $120 from watch (past $499)". */
export function worseText(text: BlueprintText, x: LensField, w: WorseMargin): string {
  return text.tx(text.B.sync_clr_worse, { label: x.label, margin: stepValue(text, x, w.margin), health: lower(verdictWord(text.B, w.health)), bound: stepValue(text, x, w.bound) });
}

/** A covered step's chip (bp CoverChip): the best proposal's verdict, on its expected change or on what was measured
 *  after it was built. `tone` is the chip's colour class. Uncovered: null (no chip). */
export function coverChip(text: BlueprintText, x: LensField | undefined, c: Coverage): { text: string; tone: 'ok' | 'short' | 'worse' | 'none' } | null {
  if (!c.covered) return null;
  const { B, tx } = text, b = c.best;
  const v = b.value === null ? '' : stepValue(text, x, b.value);
  const says = b.verdict === 'clears' ? B.sync_cov_clears : b.verdict === 'short' ? tx(B.sync_cov_short, { by: stepValue(text, x, b.short) }) : b.verdict === 'worse' ? B.sync_cov_worse : '';
  let line = b.phase === 'delivered' ? tx(B.sync_cov_delivered, { value: v, says: b.verdict === 'clears' ? B.sync_cov_cleared : says })
    : b.phase === 'expected' ? tx(B.sync_cov_expected, { status: statusWord(B, b.status), value: v, says })
    : tx(B.sync_cov_unsized, { status: statusWord(B, b.status) });
  if (c.all.length > 1) line += ' · ' + tx(B.sync_cov_more, { count: c.all.length - 1 });
  return { text: line, tone: b.verdict === 'clears' ? 'ok' : b.verdict === 'worse' ? 'worse' : b.verdict === 'short' ? 'short' : 'none' };
}

/** The callout's coverage word for a step (bp coverWord). */
export function coverWord(text: BlueprintText, x: LensField | undefined, c: Coverage): string {
  const { B, tx } = text;
  if (!c.covered) return B.sync_cov_none;
  const b = c.best;
  return b.verdict === 'clears' ? B.sync_cov_covered : b.verdict === 'short' ? tx(B.sync_cov_short, { by: stepValue(text, x, b.short) })
    : b.verdict === 'worse' ? B.sync_cov_wrong_way : B.sync_cov_unsized_word;
}

/** A blocked lens in the callout (model/ready ReadyBlock). */
export function readyBlockText(text: BlueprintText, lensName: string, why: ReadyBlock): string {
  const { B, tx } = text;
  if (why.kind === 'no-rules') return tx(B.sync_rb_no_rules, { lens: lensName });
  if (why.kind === 'path') return tx(B.sync_rb_path, { lens: lensName, why: blockText(text, why.block) });
  return tx(why.override ? B.sync_rb_no_match_ov : B.sync_rb_no_match, { lens: lensName, health: lower(verdictWord(B, why.health)) });
}

/** A cross-lens conflict (model/ready ReadyConflict); `field` is a key: its label is read from any lens declaring it. */
export function conflictText(text: BlueprintText, L: Lenses, c: ReadyConflict): string {
  const { B, tx, language } = text, name = (id: string) => L[id]?.name ?? id;
  if (c.kind === 'clash') {
    const x = c.lenses.map((id) => L[id]?.F[c.field]).find((f): f is LensField => !!f);
    const ask = c.ask.op === 'set'
      ? tx(B.sync_cf_ask_set, { a: stepValue(text, x, c.ask.a), b: stepValue(text, x, c.ask.b) })
      : tx(B.sync_cf_ask_range, { lo: stepValue(text, x, c.ask.lo), hi: stepValue(text, x, c.ask.hi) });
    return tx(B.sync_cf_clash, { field: x?.label ?? c.field, lenses: andList(language, c.lenses.map(name)), ask });
  }
  if (c.kind === 'worse') return tx(B.sync_cf_worse, { by: andList(language, c.by.map(name)), lens: name(c.lens), health: lower(verdictWord(B, c.health)) });
  return tx(B.sync_cf_still, { lens: name(c.lens), health: lower(verdictWord(B, c.health)) });
}

/** One summary part, the callout's long form (model/ready readinessLine(r, true)). */
function partText({ B, tx }: BlueprintText, p: ReadyPart): string {
  switch (p.kind) {
    case 'clear': return tx(p.n === 1 ? B.sync_rp_clear_one : B.sync_rp_clear_other, { n: p.n, clear: p.clear });
    case 'unproven': return tx(B.sync_rp_unproven, { count: p.n, days: p.maxAgeDays });
    case 'steps': return tx(p.steps === 1 ? B.sync_rp_steps_one : B.sync_rp_steps_other, { steps: p.steps, covered: p.covered, short: p.short });
    case 'blocked': return tx(B.sync_rp_blocked, { count: p.n });
    case 'conflicts': return tx(B.sync_rp_conflicts, { count: p.n });
  }
}

/** The readiness summary line: "5 features: 1 clear every lens · 1 unproven (...) · 3 steps, 1 covered, 1 short · 1 blocked". */
export function readyLineText(text: BlueprintText, parts: readonly ReadyPart[]): string {
  return parts.map((p) => partText(text, p)).join(' · ');
}
