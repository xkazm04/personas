import type { DbPersona } from '@/lib/types/types';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

/**
 * Parse last_design_result and return up to `limit` connector names.
 * Returns an empty array on missing or malformed data.
 */
export function extractConnectorNames(persona: DbPersona, limit = 4): string[] {
  if (!persona.last_design_result) return [];
  try {
    const dr = JSON.parse(persona.last_design_result) as DesignAnalysisResult;
    return (dr.suggested_connectors ?? [])
      .map((c) => (typeof c === 'string' ? c : c.name))
      .slice(0, limit);
  } catch {
    return [];
  }
}
