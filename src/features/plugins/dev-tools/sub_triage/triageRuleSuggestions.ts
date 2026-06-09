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
  kind: 'reject_heavy' | 'accept_quick' | 'reject_risky' | 'reject_category';
  /** Set only for reject_category. */
  category?: string;
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

  const eff = (i: DevIdea) => i.effort ?? 5;
  const imp = (i: DevIdea) => i.impact ?? 5;
  const rsk = (i: DevIdea) => i.risk ?? 5;

  const out: RuleSuggestion[] = [];

  // Heavy ideas get rejected → reject effort >= 8
  const heavy = decided.filter((i) => eff(i) >= 8);
  const heavyRejected = heavy.filter((i) => i.status === 'rejected').length;
  if (heavy.length >= MIN_SAMPLE && heavyRejected / heavy.length >= MIN_RATE) {
    out.push({
      kind: 'reject_heavy', action: 'reject',
      conditions: [{ field: 'effort', op: 'gte', value: 8 }],
      matched: heavyRejected, total: heavy.length,
    });
  }

  // Quick wins get accepted → accept effort <= 3 AND impact >= 7
  const quick = decided.filter((i) => eff(i) <= 3 && imp(i) >= 7);
  const quickAccepted = quick.filter((i) => i.status === 'accepted').length;
  if (quick.length >= MIN_SAMPLE && quickAccepted / quick.length >= MIN_RATE) {
    out.push({
      kind: 'accept_quick', action: 'accept',
      conditions: [{ field: 'effort', op: 'lte', value: 3 }, { field: 'impact', op: 'gte', value: 7 }],
      matched: quickAccepted, total: quick.length,
    });
  }

  // Risky ideas get rejected → reject risk >= 8
  const risky = decided.filter((i) => rsk(i) >= 8);
  const riskyRejected = risky.filter((i) => i.status === 'rejected').length;
  if (risky.length >= MIN_SAMPLE && riskyRejected / risky.length >= MIN_RATE) {
    out.push({
      kind: 'reject_risky', action: 'reject',
      conditions: [{ field: 'risk', op: 'gte', value: 8 }],
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

  // Drop anything an existing rule already covers; strongest evidence first.
  const existing = existingSignatures(rules);
  return out
    .filter((s) => !existing.has(signature(s.action, s.conditions)))
    .sort((a, b) => b.matched / b.total - a.matched / a.total || b.total - a.total);
}

export { signature as suggestionSignature };
