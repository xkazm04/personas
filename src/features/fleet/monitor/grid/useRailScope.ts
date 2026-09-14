// useRailScope — the rail's project scope, owned by the board.
//
// Clicking a column header narrows all three rail tabs to that project, and
// clicking the header that is already scoping clears it: a toggle, so the
// gesture that applied a scope is also the one that removes it and there is
// nothing to hunt for.
//
// It lives here rather than in the rail because the board is the only thing
// that knows what its own columns are made of — the team's id, the ids of the
// `dev_projects` bound to it, and the names a triage item's source label could
// carry, since that queue has no project id to match on instead.

import { useCallback, useState } from 'react';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { PersonaCardModel } from '../monitorModel';
import { cleanName } from './fleetGridModel';
import { normalizeName, type RailProjectFilter } from './rail/railFilter';

export interface RailScope {
  scope: RailProjectFilter | null;
  toggleScope: (teamId: string, teamName: string, roster: PersonaCardModel[]) => void;
  clearScope: () => void;
}

export function useRailScope(projects: readonly DevProject[]): RailScope {
  const [scope, setScope] = useState<RailProjectFilter | null>(null);
  const clearScope = useCallback(() => setScope(null), []);

  /**
   * Everything the three feeds can match a column on, gathered in one place.
   *
   * BOTH the raw and the cleaned form of every name go in. The board prints
   * `cleanName(teamName)` and the backend stores the raw one; matching on
   * either alone silently drops whichever half of the queue used the other.
   */
  const scopeFor = useCallback(
    (teamId: string, teamName: string, roster: PersonaCardModel[]): RailProjectFilter => {
      const names = new Set<string>();
      const add = (raw: string | null | undefined) => {
        if (!raw) return;
        names.add(normalizeName(raw));
        names.add(normalizeName(cleanName(raw)));
      };
      add(teamName);
      for (const card of roster) add(card.personaName);
      const projectIds = new Set<string>();
      for (const project of projects) {
        if (project.team_id !== teamId) continue;
        projectIds.add(project.id);
        add(project.name);
      }
      return { teamId, label: cleanName(teamName), projectIds, names };
    },
    [projects],
  );

  const toggleScope = useCallback(
    (teamId: string, teamName: string, roster: PersonaCardModel[]) =>
      setScope((prev) => (prev?.teamId === teamId ? null : scopeFor(teamId, teamName, roster))),
    [scopeFor],
  );

  return { scope, toggleScope, clearScope };
}
