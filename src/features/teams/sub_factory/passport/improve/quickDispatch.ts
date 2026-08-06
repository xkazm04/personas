// Quick-dispatch data spine for the SkillsWorkbench landing — the aggregate
// form of the registry matrix. Where the RegistryTab renders skill × group
// cells, the landing's quick tiles collapse each skill to ONE number: how much
// of the whole repo (all context groups) it has actually touched. Clicking a
// tile dispatches the skill with NO arguments — the skill picks its own
// context, and Fleet is the dispatch channel (wb.runDispatch).
//
// Built directly on `useProjectRegistry` so the tiles and the full registry
// can never disagree about coverage.
import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';

import { coveragePct } from '@/features/plugins/dev-tools/sub_skills/registry/registryTypes';
import { useProjectRegistry } from '@/features/plugins/dev-tools/sub_skills/registry/useProjectRegistry';

/** hex (#RRGGBB) → rgba with the given alpha (same helper the heatmap uses). */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Fallback lens colour for custom (non-preset) skills — matches the heatmap. */
export const NEUTRAL_HUE = '#6366f1';

export interface QuickGroup {
  id: string;
  name: string;
  color: string | null;
  /** Contexts in the group (coverage denominator). */
  units: number;
  /** Contexts of the group this skill has touched. */
  covered: number;
  pct: number;
}

export interface QuickSkill {
  name: string;
  visual: { icon: LucideIcon; color: string; label: string } | null;
  category: string;
  /** Total repo coverage: touched contexts / all contexts, 0–100. */
  pct: number;
  /** Touched contexts across every group. */
  covered: number;
  invokes30d: number;
  /** A Fleet session is running this skill here right now. */
  running: boolean;
  groups: QuickGroup[];
}

export interface QuickDispatchModel {
  loading: boolean;
  /** All contexts across the project's groups (the shared denominator). */
  contextTotal: number;
  skills: QuickSkill[];
}

/** Props every quick-dispatch variant renders from — identical across variants
 *  so the switcher can swap them freely. */
export interface QuickDispatchProps {
  model: QuickDispatchModel;
  /** Skill currently spawning (optimistic guard). */
  busySkill: string | null;
  onDispatch: (name: string) => void;
}

export function useQuickDispatch(slug: string): QuickDispatchModel {
  const registry = useProjectRegistry(slug);

  return useMemo(() => {
    const contextTotal = registry.columns.reduce((n, c) => n + c.units, 0);
    const skills: QuickSkill[] = registry.skills.map((s) => {
      let covered = 0;
      let running = false;
      const groups: QuickGroup[] = registry.columns.map((c) => {
        const cell = registry.cell(s.name, c.id);
        covered += cell.coveredUnits;
        running ||= cell.running;
        return {
          id: c.id,
          name: c.name,
          color: c.color ?? null,
          units: c.units,
          covered: cell.coveredUnits,
          pct: coveragePct(cell, c.units),
        };
      });
      return {
        name: s.name,
        visual: s.visual,
        category: s.category,
        pct: contextTotal > 0 ? Math.round((covered / contextTotal) * 100) : 0,
        covered,
        invokes30d: s.totalInvokes,
        running,
        groups,
      };
    });
    return { loading: registry.loading, contextTotal, skills };
  }, [registry]);
}
