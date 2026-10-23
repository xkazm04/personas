/**
 * Draft <-> stored conversions for the gig persona policy form
 * (GigPersonaPolicySection). The policy auto-approves kp hires inside its
 * bound, so the one rule that must never slip is "a budget the field cannot
 * read is refused, never sent": an unparseable number input reads as '' and
 * NaN serializes to null, and either would silently mean NO CAP.
 */
import type { GigPersonaPolicy } from '@/api/auth/gigPersonaPolicy';

export interface Draft {
  enabled: boolean;
  maxBudgetUsd: string;
  /** The number input holds text it cannot parse (its `value` then reads ''). */
  budgetBadInput: boolean;
  allowedModels: string;
  rootPath: string;
}

export function toDraft(p: GigPersonaPolicy): Draft {
  return {
    enabled: p.enabled,
    // A stored `null` is no cap, shown as an empty field.
    maxBudgetUsd: p.maxBudgetUsd === null ? '' : String(p.maxBudgetUsd),
    budgetBadInput: false,
    allowedModels: p.allowedModels.join(', '),
    rootPath: p.rootPath,
  };
}

/** An empty budget field is no cap (`null`); anything else is the typed number. */
export function budgetFromDraft(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/**
 * A budget the field cannot read. Saving it is blocked rather than sent: a
 * number input reports unparseable text (`5,5` in a `.`-decimal locale) as an
 * EMPTY value, and NaN serializes to `null` — either way a typo would silently
 * read as "no cap".
 */
export function budgetUnreadable(d: Draft): boolean {
  if (d.budgetBadInput) return true;
  const budget = budgetFromDraft(d.maxBudgetUsd);
  return budget !== null && !Number.isFinite(budget);
}

export function fromDraft(d: Draft): GigPersonaPolicy {
  return {
    enabled: d.enabled,
    maxBudgetUsd: budgetFromDraft(d.maxBudgetUsd),
    allowedModels: d.allowedModels
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0),
    rootPath: d.rootPath.trim(),
  };
}
