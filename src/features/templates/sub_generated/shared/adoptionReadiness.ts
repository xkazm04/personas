import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { ARCH_CATEGORIES, computeCategoryReadiness, userHasCategoryCredential } from '../gallery/matrix/architecturalCategories';

interface SuggestedConnectorShape {
  name?: string;
  label?: string;
  category?: string;
  optional?: boolean;
}

/**
 * Read the template's structured connector list from design_result.
 * Prefers suggested_connectors (has category + optional flag) over
 * the fallback service_flow string parsing.
 */
function getRequiredConnectorCategories(review: PersonaDesignReview): string[] | null {
  if (!review.design_result) return null;
  try {
    const dr = JSON.parse(review.design_result) as Record<string, unknown>;
    const suggested = (dr.suggested_connectors ?? []) as SuggestedConnectorShape[];
    if (suggested.length === 0) return null;
    const categories = new Set<string>();
    for (const sc of suggested) {
      if (sc.optional) continue; // optional connectors don't count toward readiness
      if (sc.category && ARCH_CATEGORIES[sc.category]) {
        categories.add(sc.category);
      }
    }
    return [...categories];
  } catch {
    return null;
  }
}

/**
 * Compute a 0-100 adoption readiness score for a template based on
 * whether the user has credentials for the architectural component
 * categories the template requires (e.g. messaging, database, email).
 *
 * Reads required categories from `design_result.suggested_connectors[].category`
 * (skipping any connector marked `optional: true`). Falls back to parsing
 * `connectors_used` service_flow strings when suggested_connectors is missing.
 *
 * This evaluates at the *category* level rather than per-connector,
 * so having any email client unlocks all email-dependent templates.
 */
export function computeAdoptionReadiness(
  review: PersonaDesignReview,
  _installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
): number {
  // Primary path: structured suggested_connectors with category + optional flag
  const structuredCategories = getRequiredConnectorCategories(review);
  if (structuredCategories !== null) {
    if (structuredCategories.length === 0) return 100;
    let ready = 0;
    for (const cat of structuredCategories) {
      if (userHasCategoryCredential(cat, credentialServiceTypes)) ready++;
    }
    return Math.round((ready / structuredCategories.length) * 100);
  }

  // Fallback path: parse connectors_used (service_flow strings)
  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  if (connectors.length === 0) return 100;

  const { total, ready } = computeCategoryReadiness(connectors, credentialServiceTypes);
  if (total === 0) return 100;
  return Math.round((ready / total) * 100);
}

/** Color + label helpers for readiness scores. */
export function readinessTier(score: number): { label: string; color: string; bgClass: string } {
  if (score === 100) return { label: 'Ready', color: 'emerald', bgClass: 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20' };
  if (score > 0) return { label: 'Partial', color: 'amber', bgClass: 'bg-amber-500/10 text-amber-400/70 border-amber-500/15' };
  return { label: 'Setup needed', color: 'zinc', bgClass: 'bg-zinc-500/10 text-muted-foreground/50 border-zinc-500/15' };
}
