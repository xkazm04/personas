import { useMemo } from 'react';
import type { DbPersona } from '@/lib/types/types';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

// ── Relevance Score ─────────────────────────────────────────────────
// Composite urgency score: higher = more relevant / needs attention first.
// Components:
//   - Health urgency (0–40): failing > degraded > dormant > healthy
//   - Recency boost (0–30): recently run agents float up, stale ones get moderate urgency
//   - Trigger density (0–15): more triggers = more important
//   - Active bonus (0–15): enabled agents rank above disabled

export interface ScoredPersona {
  persona: DbPersona;
  score: number;
  section: 'attention' | 'active' | 'idle';
}

const HEALTH_SCORES: Record<string, number> = {
  failing: 40,
  degraded: 30,
  dormant: 10,
  healthy: 5,
};

const STALE_DAYS = 7;
const MS_PER_DAY = 86_400_000;

function computeRelevanceScore(
  persona: DbPersona,
  health: PersonaHealth | undefined,
  lastRun: string | null | undefined,
  triggerCount: number,
): { score: number; section: 'attention' | 'active' | 'idle' } {
  let score = 0;
  let section: 'attention' | 'active' | 'idle' = 'idle';

  // Health urgency (0–40)
  const status = health?.status ?? 'dormant';
  score += HEALTH_SCORES[status] ?? 10;

  // Low success rate adds urgency
  if (health && health.totalRecent > 0 && health.successRate < 0.7) {
    score += 15;
  }

  // Recency (0–30)
  if (lastRun) {
    const age = Date.now() - new Date(lastRun).getTime();
    if (!isNaN(age)) {
      if (age <= MS_PER_DAY) {
        // Ran today — high recency, active agent
        score += 30;
        section = 'active';
      } else if (age <= 3 * MS_PER_DAY) {
        score += 22;
        section = 'active';
      } else if (age <= STALE_DAYS * MS_PER_DAY) {
        score += 15;
        section = 'active';
      } else {
        // Stale — moderate urgency bump (might need attention)
        score += 18;
      }
    }
  }

  // Trigger density (0–15)
  score += Math.min(15, triggerCount * 3);

  // Active bonus (0–15)
  if (persona.enabled) {
    score += 15;
  }

  // Determine section
  if (
    status === 'failing' ||
    status === 'degraded' ||
    (health && health.totalRecent > 0 && health.successRate < 0.7) ||
    (lastRun && Date.now() - new Date(lastRun).getTime() > STALE_DAYS * MS_PER_DAY && persona.enabled)
  ) {
    section = 'attention';
  }

  return { score, section };
}

export function useRelevanceSort(
  personas: DbPersona[],
  healthMap: Record<string, PersonaHealth>,
  lastRunMap: Record<string, string | null>,
  triggerCounts: Record<string, number>,
): ScoredPersona[] {
  return useMemo(() => {
    const scored = personas.map((persona): ScoredPersona => {
      const { score, section } = computeRelevanceScore(
        persona,
        healthMap[persona.id],
        lastRunMap[persona.id],
        triggerCounts[persona.id] ?? 0,
      );
      return { persona, score, section };
    });

    // Sort: attention first, then by score descending
    const sectionOrder: Record<string, number> = { attention: 0, active: 1, idle: 2 };
    scored.sort((a, b) => {
      const so = (sectionOrder[a.section] ?? 2) - (sectionOrder[b.section] ?? 2);
      if (so !== 0) return so;
      return b.score - a.score;
    });

    return scored;
  }, [personas, healthMap, lastRunMap, triggerCounts]);
}
