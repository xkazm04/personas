import { useMemo } from 'react';
import { CATEGORY_ROLE_GROUPS, type RoleGroup } from '../search/filters/searchConstants';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

/**
 * An automation opportunity: a role group where the user has partial or full
 * connector coverage and high-value templates they haven't adopted yet.
 */
export interface AutomationOpportunity {
  group: RoleGroup;
  /** Templates in this group reachable with 0 additional connectors */
  readyNow: PersonaDesignReview[];
  /** Templates reachable with exactly 1 additional connector */
  oneConnectorAway: PersonaDesignReview[];
  /** The single connector needed most often across oneConnectorAway templates */
  suggestedConnector: string | null;
  /** 0..1 score combining coverage, popularity, and gap size */
  score: number;
  /** How many of the group's categories the user already has coverage for */
  coveredCategories: number;
  totalCategories: number;
}

function parseConnectors(t: PersonaDesignReview): string[] {
  if (!t.connectors_used) return [];
  try { return JSON.parse(t.connectors_used) as string[]; }
  catch { return []; }
}

/**
 * Proactive discovery engine: inverts the adoption-readiness question.
 * Instead of "which templates match my connectors?", asks
 * "which high-value template categories can I unlock with 0-1 more connectors?"
 */
export function useAutomationDiscovery(
  allTemplates: PersonaDesignReview[],
  userServiceTypes: string[],
): AutomationOpportunity[] {
  return useMemo(() => {
    if (allTemplates.length === 0) return [];

    const userServices = new Set(userServiceTypes.map(s => s.toLowerCase()));

    // Index templates by category (single pass)
    const byCategory = new Map<string, PersonaDesignReview[]>();
    for (const t of allTemplates) {
      if (!t.category) continue;
      const cat = t.category.toLowerCase();
      let bucket = byCategory.get(cat);
      if (!bucket) { bucket = []; byCategory.set(cat, bucket); }
      bucket.push(t);
    }

    const opportunities: AutomationOpportunity[] = [];

    for (const group of CATEGORY_ROLE_GROUPS) {
      const readyNow: PersonaDesignReview[] = [];
      const oneAway: PersonaDesignReview[] = [];
      const missingConnectorCounts = new Map<string, number>();
      let coveredCategories = 0;

      for (const catName of group.categories) {
        const templates = byCategory.get(catName) ?? [];
        let hasCoverage = false;

        for (const t of templates) {
          const connectors = parseConnectors(t).map(c => c.toLowerCase());
          if (connectors.length === 0) {
            // No connectors needed — always ready
            readyNow.push(t);
            hasCoverage = true;
            continue;
          }

          const missing = connectors.filter(c => !userServices.has(c));

          if (missing.length === 0) {
            readyNow.push(t);
            hasCoverage = true;
          } else if (missing.length === 1) {
            oneAway.push(t);
            hasCoverage = true;
            const key = missing[0]!;
            missingConnectorCounts.set(key, (missingConnectorCounts.get(key) ?? 0) + 1);
          }
          // missing > 1: too far away, skip
        }

        if (hasCoverage) coveredCategories++;
      }

      // No opportunities in this group
      if (readyNow.length === 0 && oneAway.length === 0) continue;

      // Find the most impactful missing connector
      let suggestedConnector: string | null = null;
      let maxCount = 0;
      for (const [conn, count] of missingConnectorCounts) {
        if (count > maxCount) { maxCount = count; suggestedConnector = conn; }
      }

      // Sort by adoption count descending within each bucket
      readyNow.sort((a, b) => b.adoption_count - a.adoption_count);
      oneAway.sort((a, b) => b.adoption_count - a.adoption_count);

      // Score: weighted combination of readiness, popularity, and category coverage
      const totalPop = [...readyNow, ...oneAway].reduce((sum, t) => sum + t.adoption_count, 0);
      const popularityScore = Math.min(totalPop / 50, 1); // normalize
      const coverageRatio = group.categories.length > 0 ? coveredCategories / group.categories.length : 0;
      const readyRatio = readyNow.length / Math.max(readyNow.length + oneAway.length, 1);
      const score = readyRatio * 0.4 + popularityScore * 0.35 + coverageRatio * 0.25;

      opportunities.push({
        group,
        readyNow: readyNow.slice(0, 4),
        oneConnectorAway: oneAway.slice(0, 4),
        suggestedConnector,
        score,
        coveredCategories,
        totalCategories: group.categories.length,
      });
    }

    // Sort opportunities by score descending
    opportunities.sort((a, b) => b.score - a.score);

    return opportunities;
  }, [allTemplates, userServiceTypes]);
}
