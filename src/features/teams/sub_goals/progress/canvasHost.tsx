/**
 * The canvas HOST: everything a row needs to be acted on, assembled once and
 * handed to whichever layout is drawing.
 *
 * One context so a VARIANT is a file that arranges rows, not a file that
 * forwards twenty props - the same shape `goalDetail/` uses, and the reason
 * three layouts over this model are cheap.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { DevLifecycleT } from '../progressShared';
import { MilestoneNameModal } from './MilestoneNameModal';
import type { MilestoneLane } from './milestoneOps';
import { useGoalDrag, useLaneDrop, type GoalDragState, type LaneDrop } from './rowCanvas';
import { useCanvasMenu, type CanvasTarget } from './useCanvasMenu';
import { useProgressCanvas } from './useProgressCanvas';
import type { ProgressModel } from './useProgressModel';

export interface CanvasHost {
  /** `null` while the lanes are still loading - the goals are already drawn. */
  lanesByProject: ReadonlyMap<string, MilestoneLane[]> | null;
  lanesOfGoal: (goalId: string) => string[];
  /** A mutation is in flight. The canvas stays usable; controls say so. */
  busy: boolean;
  drag: GoalDragState;
  drop: LaneDrop;
  /** Open the context menu. Wire through `useMenuKey` for keyboard parity. */
  openMenu: (e: React.MouseEvent, target: CanvasTarget) => void;
  bindGoal: (goalId: string, milestoneId: string | null) => void;
  deleteMilestone: (milestoneId: string) => void;
  startCreateMilestone: (projectId: string) => void;
}

export interface ProgressView {
  model: ProgressModel;
  canvas: CanvasHost;
  openGoal: (id: string) => void;
  createGoalIn: (projectId: string) => void;
  dl: DevLifecycleT;
}

const Ctx = createContext<ProgressView | null>(null);

export function ProgressViewProvider({ value, children }: { value: ProgressView; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Throws rather than returning null: a row rendered outside the provider is a
 *  wiring mistake, and a silent `?.` would read as missing data. */
export function useProgressView(): ProgressView {
  const v = useContext(Ctx);
  if (!v) throw new Error('useProgressView must be used inside <ProgressViewProvider>');
  return v;
}

/**
 * The host and its overlays come back SEPARATELY on purpose. The menu portal
 * and the name dialog are a fresh element tree every render by construction, so
 * carrying them inside the context value would make that value change on every
 * render and defeat the memo for every row reading it.
 */
export function useCanvasHost(opts: {
  projectIds: readonly string[];
  projectNames: ReadonlyMap<string, string>;
  createGoalIn: (projectId: string) => void;
}): { host: CanvasHost; overlays: ReactNode } {
  const canvas = useProgressCanvas(opts.projectIds);
  const [pendingProject, setPendingProject] = useState<string | null>(null);
  const drag = useGoalDrag();

  const onBind = useCallback(
    (goalId: string, milestoneId: string | null) => {
      drag.onDragEnd();
      canvas.bindGoal(goalId, milestoneId);
    },
    [canvas, drag],
  );
  const drop = useLaneDrop(onBind);

  const { openMenu, menu } = useCanvasMenuBridge({
    canvas,
    onCreateGoal: opts.createGoalIn,
    onCreateMilestone: setPendingProject,
    onBind,
  });

  const overlays = (
    <>
      {menu}
      <MilestoneNameModal
        isOpen={pendingProject !== null}
        projectName={pendingProject ? (opts.projectNames.get(pendingProject) ?? '') : ''}
        onCancel={() => setPendingProject(null)}
        onConfirm={(name) => {
          if (pendingProject) canvas.createMilestone(pendingProject, name);
          setPendingProject(null);
        }}
      />
    </>
  );

  const host = useMemo<CanvasHost>(
    () => ({
      lanesByProject: canvas.lanesByProject,
      lanesOfGoal: canvas.lanesOfGoal,
      busy: canvas.busy,
      drag,
      drop,
      openMenu,
      bindGoal: onBind,
      deleteMilestone: canvas.deleteMilestone,
      startCreateMilestone: setPendingProject,
    }),
    [canvas, drag, drop, openMenu, onBind],
  );

  return { host, overlays };
}

/** Thin adapter so `useCanvasHost` reads as a list of wirings. */
function useCanvasMenuBridge(a: {
  canvas: ReturnType<typeof useProgressCanvas>;
  onCreateGoal: (projectId: string) => void;
  onCreateMilestone: (projectId: string) => void;
  onBind: (goalId: string, milestoneId: string | null) => void;
}) {
  const { openAt, menu } = useCanvasMenu({
    lanesByProject: a.canvas.lanesByProject,
    lanesOfGoal: a.canvas.lanesOfGoal,
    onCreateMilestone: a.onCreateMilestone,
    onDeleteMilestone: a.canvas.deleteMilestone,
    onCreateGoal: a.onCreateGoal,
    onBindGoal: a.onBind,
  });
  return { openMenu: openAt, menu };
}
