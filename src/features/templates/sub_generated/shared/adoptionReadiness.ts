import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { computeCategoryReadiness } from '../gallery/matrix/architecturalCategories';

/**
 * Compute a 0-100 adoption readiness score for a template based on
 * whether the user has credentials for the architectural component
 * categories the template requires (e.g. messaging, database, email).
 *
 * This evaluates at the *category* level rather than per-connector,
 * so having any email client unlocks all email-dependent templates.
 */
export function computeAdoptionReadiness(
  review: PersonaDesignReview,
  _installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
): number {
  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  if (connectors.length === 0) return 100; // no connectors needed = fully ready

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
