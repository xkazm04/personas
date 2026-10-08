/**
 * The layered views' state and reads, shared by all three layouts.
 *
 *   useLayerNav      where the operator is: portfolio (L0) > project (L1) >
 *                    milestone (L2), plus the goal selected inside L2. Escape
 *                    climbs one rung.
 *   useBriefNotes    the notepad's notes, loaded once. The pad loads its store
 *                    only when it opens, so a surface that reads briefs without
 *                    the pad must ask for them itself.
 *   useProjectLayer  one project shaped by `buildProjectLayer`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { silentCatch } from '@/lib/silentCatch';
import type { DevNote } from '@/lib/bindings/DevNote';
import { load as loadNotepad } from '@/features/notepad/notepadStore';
import { useNotepadNotes, useNotepadStatus } from '@/features/notepad/useNotepad';

import { useProgressView } from '../canvasHost';
import { buildProjectLayer, type ProjectLayer } from './layerModel';

/** `UNASSIGNED` stands in for a milestone id when L2 shows the unbound goals. */
export const UNASSIGNED = '__unassigned__';

export interface LayerNav {
  projectId: string | null;
  /** A milestone id, `UNASSIGNED`, or `null` (L1 showing, no L2). */
  milestoneId: string | null;
  goalId: string | null;
  /** 0 portfolio, 1 project, 2 milestone. */
  depth: 0 | 1 | 2;
  openProject: (projectId: string) => void;
  openMilestone: (milestoneId: string) => void;
  selectGoal: (goalId: string | null) => void;
  back: () => void;
  home: () => void;
}

export function useLayerNav(): LayerNav {
  const [projectId, setProject] = useState<string | null>(null);
  const [milestoneId, setMilestone] = useState<string | null>(null);
  const [goalId, setGoal] = useState<string | null>(null);
  const depth: LayerNav['depth'] = milestoneId ? 2 : projectId ? 1 : 0;

  const back = useCallback(() => {
    if (goalId) return setGoal(null);
    if (milestoneId) return setMilestone(null);
    setProject(null);
  }, [goalId, milestoneId]);

  // Escape climbs one rung while anything is open; at L0 it is not ours.
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || depth === 0) return false;
      back();
      return true;
    },
    { enabled: depth > 0 },
  );

  return {
    projectId,
    milestoneId,
    goalId,
    depth,
    openProject: useCallback((id: string) => {
      setProject(id);
      setMilestone(null);
      setGoal(null);
    }, []),
    openMilestone: useCallback((id: string) => {
      setMilestone(id);
      setGoal(null);
    }, []),
    selectGoal: setGoal,
    back,
    home: useCallback(() => {
      setProject(null);
      setMilestone(null);
      setGoal(null);
    }, []),
  };
}

export function useBriefNotes(): { notes: DevNote[]; loaded: boolean } {
  const record = useNotepadNotes();
  const { loaded, loading } = useNotepadStatus();
  useEffect(() => {
    if (!loaded && !loading) void loadNotepad().catch(silentCatch('GoalsLayers.loadNotes'));
    // Once per mount: `load` refreshes underneath an open pad, never blanks it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const notes = useMemo(
    () => Object.values(record).filter((n) => n.status !== 'archived'),
    [record],
  );
  return { notes, loaded };
}

/** `null` until the project's lanes have arrived. */
export function useProjectLayer(projectId: string | null): ProjectLayer | null {
  const { model, canvas } = useProgressView();
  const { notes } = useBriefNotes();
  return useMemo(() => {
    if (!projectId) return null;
    const lanes = canvas.lanesByProject?.get(projectId);
    if (!lanes) return null;
    const name = model.rows.find((r) => r.projectId === projectId)?.name ?? '';
    return buildProjectLayer({ projectId, name, goals: model.allGoals ?? [], lanes, notes });
  }, [projectId, canvas.lanesByProject, model.rows, model.allGoals, notes]);
}
