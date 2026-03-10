import type { DbPersona } from '@/lib/types/types';
<<<<<<< HEAD
import type { AgentIR } from '@/lib/types/designTypes';
=======
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

/**
 * Parse last_design_result and return up to `limit` connector names.
 * Returns an empty array on missing or malformed data.
 */
export function extractConnectorNames(persona: DbPersona, limit = 4): string[] {
  if (!persona.last_design_result) return [];
  try {
<<<<<<< HEAD
    const dr = JSON.parse(persona.last_design_result) as AgentIR;
=======
    const dr = JSON.parse(persona.last_design_result) as DesignAnalysisResult;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
    return (dr.suggested_connectors ?? [])
      .map((c) => (typeof c === 'string' ? c : c.name))
      .slice(0, limit);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return [];
  }
}
