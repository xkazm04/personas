import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { TriageRule } from '@/lib/bindings/TriageRule';
import { silentCatch } from '@/lib/silentCatch';

// ---------------------------------------------------------------------------
// Rule suggestions mined from past triage decisions.
//
// Deterministic, explainable heuristics only: each suggestion names the
// pattern, carries the evidence (matched/total decided ideas), and maps to the
// same {field, op, value} conditions the TriageRulesPanel authors by hand.
// ---------------------------------------------------------------------------

export interface SuggestionCondition {
  field: string;
  op: string;
  value: number | string;
}

export interface RuleSuggestion {
  /** i18n discriminator — resolved to dev_triage.suggestion_name_* */
  kind: 'reject_heavy' | 'accept_quick' | 'reject_risky' | 'reject_category' | 'reject_origin';
  /** Set only for reject_category. */
  category?: string;
  /** Set only for reject_origin — the sensor whose findings keep getting rejected. */
  origin?: string;
  conditions: SuggestionCondition[];
  action: 'accept' | 'reject';
  matched: number;
  total: number;
}

/** Normalized signature for deduping suggestions against existing rules. */
function signature(action: string, conditions: SuggestionCondition[]): string {
  const conds = [...conditions]
    .sort((a, b) => a.field.localeCompare(b.field))
    .map((c) => `${c.field} ${c.op} ${c.value}`)
    .join(' AND ');
  return `${action}: ${conds}`;
}

function existingSignatures(rules: TriageRule[]): Set<string> {
  const out = new Set<string>();
  for (const r of rules) {
    try {
      const conds = JSON.parse(r.conditions) as SuggestionCondition[];
      out.add(signature(r.action, conds));
    } catch (err) {
      // Malformed rule conditions — skip for dedup purposes.
      silentCatch('triageRuleSuggestions:existingSignatures')(err);
    }
  }
  return out;
}

const MIN_SAMPLE = 4;
const MIN_RATE = 0.8;
const MIN_CATEGORY_SAMPLE = 5;
const MIN_CATEGORY_RATE = 0.85;

/**
 * Mine rule suggestions from decided (accepted/rejected) ideas. Returns at
 * most one suggestion per pattern, strongest evidence first, with anything
 * already covered by an existing rule filtered out.
 */
export function suggestTriageRules(ideas: DevIdea[], rules: TriageRule[]): RuleSuggestion[] {
  const decided = ideas.filter((i) => i.status === 'accepted' || i.status === 'rejected');
  if (decided.length < MIN_SAMPLE) return [];

  // The stand-in for an unrated idea is the MIDPOINT of the scale
  // (`personas_core::models::IDEA_SCALE_MAX` is 5), so an unrated row pulls a
  // pattern in no direction. It read 5 while the column carried a ten-point
  // scale, which was the midpoint then and is the ceiling now — an unrated
  // idea would have been mined as maximally heavy, impactful and risky at once.
  const eff = (i: DevIdea) => i.effort ?? 3;
  const imp = (i: DevIdea) => i.impact ?? 3;
  const rsk = (i: DevIdea) => i.risk ?? 3;

  const out: RuleSuggestion[] = [];

  // Heavy ideas get rejected → reject effort >= 4
  const heavy = decided.filter((i) => eff(i) >= 4);
  const heavyRejected = heavy.filter((i) => i.status === 'rejected').length;
  if (heavy.length >= MIN_SAMPLE && heavyRejected / heavy.length >= MIN_RATE) {
    out.push({
      kind: 'reject_heavy', action: 'reject',
      conditions: [{ field: 'effort', op: 'gte', value: 4 }],
      matched: heavyRejected, total: heavy.length,
    });
  }

  // Quick wins get accepted → accept effort <= 2 AND impact >= 4
  const quick = decided.filter((i) => eff(i) <= 2 && imp(i) >= 4);
  const quickAccepted = quick.filter((i) => i.status === 'accepted').length;
  if (quick.length >= MIN_SAMPLE && quickAccepted / quick.length >= MIN_RATE) {
    out.push({
      kind: 'accept_quick', action: 'accept',
      conditions: [{ field: 'effort', op: 'lte', value: 2 }, { field: 'impact', op: 'gte', value: 4 }],
      matched: quickAccepted, total: quick.length,
    });
  }

  // Risky ideas get rejected → reject risk >= 4
  const risky = decided.filter((i) => rsk(i) >= 4);
  const riskyRejected = risky.filter((i) => i.status === 'rejected').length;
  if (risky.length >= MIN_SAMPLE && riskyRejected / risky.length >= MIN_RATE) {
    out.push({
      kind: 'reject_risky', action: 'reject',
      conditions: [{ field: 'risk', op: 'gte', value: 4 }],
      matched: riskyRejected, total: risky.length,
    });
  }

  // One category the user consistently rejects → reject category = X
  const byCategory = new Map<string, { total: number; rejected: number }>();
  for (const i of decided) {
    const entry = byCategory.get(i.category) ?? { total: 0, rejected: 0 };
    entry.total++;
    if (i.status === 'rejected') entry.rejected++;
    byCategory.set(i.category, entry);
  }
  const categoryHit = [...byCategory.entries()]
    .filter(([, v]) => v.total >= MIN_CATEGORY_SAMPLE && v.rejected / v.total >= MIN_CATEGORY_RATE)
    .sort((a, b) => b[1].total - a[1].total)[0];
  if (categoryHit) {
    out.push({
      kind: 'reject_category', action: 'reject', category: categoryHit[0],
      conditions: [{ field: 'category', op: 'eq', value: categoryHit[0] }],
      matched: categoryHit[1].rejected, total: categoryHit[1].total,
    });
  }

  // B3 — rejection learning across the findings spine. A sensor whose findings the
  // user keeps saying no to is mis-thresholded: it's raising work that isn't worth
  // doing. Surfacing that as a rule ("auto-reject llm_cost") is the honest response —
  // the alternative is the user silently swiping the same noise away forever.
  // Deliberately advisory: we suggest, the user commits. We never retune a sensor's
  // threshold behind their back.
  const byOrigin = new Map<string, { total: number; rejected: number }>();
  for (const i of decided) {
    if (!i.origin) continue; // classic scanner ideas — covered by the rules above
    const entry = byOrigin.get(i.origin) ?? { total: 0, rejected: 0 };
    entry.total++;
    if (i.status === 'rejected') entry.rejected++;
    byOrigin.set(i.origin, entry);
  }
  const originHit = [...byOrigin.entries()]
    .filter(([, v]) => v.total >= MIN_CATEGORY_SAMPLE && v.rejected / v.total >= MIN_CATEGORY_RATE)
    .sort((a, b) => b[1].total - a[1].total)[0];
  if (originHit) {
    out.push({
      kind: 'reject_origin', action: 'reject', origin: originHit[0],
      conditions: [{ field: 'origin', op: 'eq', value: originHit[0] }],
      matched: originHit[1].rejected, total: originHit[1].total,
    });
  }

  // Drop anything an existing rule already covers; strongest evidence first.
  const existing = existingSignatures(rules);
  return out
    .filter((s) => !existing.has(signature(s.action, s.conditions)))
    .sort((a, b) => b.matched / b.total - a.matched / a.total || b.total - a.total);
}

export { signature as suggestionSignature };
