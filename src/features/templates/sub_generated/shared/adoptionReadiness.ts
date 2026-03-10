import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
<<<<<<< HEAD
import type { AgentIR } from '@/lib/types/designTypes';
=======
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import { parseJsonSafe } from '@/lib/utils/parseJson';
import { deriveConnectorReadiness } from './ConnectorReadiness';

/**
 * Compute a 0-100 adoption readiness score for a template based on
 * the user's installed connectors and configured credentials.
 */
export function computeAdoptionReadiness(
  review: PersonaDesignReview,
  installedConnectorNames: Set<string>,
  credentialServiceTypes: Set<string>,
): number {
  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  if (connectors.length === 0) return 100; // no connectors needed = fully ready

<<<<<<< HEAD
  const designResult = parseJsonSafe<AgentIR | null>(review.design_result, null);
=======
  const designResult = parseJsonSafe<DesignAnalysisResult | null>(review.design_result, null);
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  const statuses = designResult?.suggested_connectors
    ? deriveConnectorReadiness(designResult.suggested_connectors, installedConnectorNames, credentialServiceTypes)
    : [];

  const readyCount = connectors.filter((c) => {
    const s = statuses.find((st) => st.connector_name === c);
    return s?.health === 'ready';
  }).length;

  return Math.round((readyCount / connectors.length) * 100);
}

/** Color + label helpers for readiness scores. */
export function readinessTier(score: number): { label: string; color: string; bgClass: string } {
  if (score === 100) return { label: 'Ready', color: 'emerald', bgClass: 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20' };
  if (score > 0) return { label: 'Partial', color: 'amber', bgClass: 'bg-amber-500/10 text-amber-400/70 border-amber-500/15' };
  return { label: 'Setup needed', color: 'zinc', bgClass: 'bg-zinc-500/10 text-muted-foreground/50 border-zinc-500/15' };
}
