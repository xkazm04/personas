/**
 * @deprecated The legacy `IDEA_CATEGORIES` vocabulary
 * (functionality / performance / maintenance / ui / code_quality / user_benefit)
 * has been retired in favor of the canonical `IdeaCategory` enum exported
 * from Rust (`src/lib/bindings/IdeaCategory.ts`). The triage UI uses
 * `AGENT_CATEGORIES` from `./scanAgents` which already aligns with the
 * canonical {technical, user, business, mastermind} keys.
 *
 * The DB has a one-shot migration (`reconcile_idea_category_vocabulary`)
 * that maps legacy rows to canonical values; new code should not import
 * from this module.
 *
 * This shim is kept as a typed export so external references degrade
 * gracefully — every legacy key maps to its canonical equivalent.
 */
import type { IdeaCategory } from '@/lib/bindings/IdeaCategory';

/** Legacy → canonical mapping. Mirrors `IdeaCategory::from_token` in Rust. */
export const LEGACY_IDEA_CATEGORY_MAP: Readonly<Record<string, IdeaCategory>> = Object.freeze({
  functionality: 'technical',
  performance: 'technical',
  maintenance: 'technical',
  code_quality: 'technical',
  ui: 'user',
  user_benefit: 'user',
  // Canonical pass-through
  technical: 'technical',
  user: 'user',
  business: 'business',
  mastermind: 'mastermind',
});

/** Map any (canonical or legacy) token to its canonical equivalent, or `undefined`. */
export function toCanonicalIdeaCategory(token: string | null | undefined): IdeaCategory | undefined {
  if (!token) return undefined;
  return LEGACY_IDEA_CATEGORY_MAP[token];
}
