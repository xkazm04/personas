// ALTITUDE — the descent every overview surface shares.
//
// Portfolio › Project happens INSIDE the surface, so the estate never leaves
// the screen and going back is one key. Group and KPI are handed up: the
// dispatcher opens the existing Project › Group layer for a group, and the
// KPI detail modal for a single KPI. Four levels, two of them owned here.
//
// Escape climbs exactly one rung, and only when nothing is stacked above it —
// the same guard `KpiGroupLayer` uses, so one press never closes two things.
import { useCallback, useState } from 'react';

import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';

import type { Estate, EstateProject } from './kpiEstate';
import { findProject } from './kpiEstate';

export interface KpiAltitude {
  /** The project we have descended into, or null at portfolio altitude. */
  project: EstateProject | null;
  /** Where we are, for the rail that has to print it. */
  level: 'portfolio' | 'project';
  descend: (projectId: string) => void;
  climb: () => void;
}

export function useKpiAltitude(estate: Estate): KpiAltitude {
  const [projectId, setProjectId] = useState<string | null>(null);
  // A project that disappeared under us (a refetch dropped it) is not an
  // error state to render — it is simply the portfolio again.
  const project = findProject(estate, projectId);
  const climb = useCallback(() => setProjectId(null), []);

  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || projectId == null) return;
      if (document.querySelector('[role="dialog"]')) return;
      climb();
      return true;
    },
    { priority: ROUTE_DECISION_PRIORITY + 5 },
  );

  return { project, level: project ? 'project' : 'portfolio', descend: setProjectId, climb };
}
