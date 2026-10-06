/**
 * VARIANT - BUSBAR. Ported from the goals-filmstrip-r2 contest winner (B/3).
 * THESIS: the milestone-goal relation is drawn as wiring. A milestone is a
 * coloured rail leaving a numbered hex terminal; every bound goal hangs from it
 * on a drop wire; a goal with no milestone hangs from a dashed open bus by a
 * loose stub. The rail is also the progress bar.
 *
 * The open project expands into a framed sheet; every other project stays a
 * compact bus strip, so the whole portfolio is still one scroll. A modal
 * status line at the bottom carries the cursor and the key grammar.
 *
 * What is real: every bind, move and unbind is a write through `milestoneOps`
 * (via the canvas host), accept goes through the store's `acceptGoal`, a new
 * milestone through the shared name dialog, and undo restores the former
 * membership rows through the same seam. See useBusbarState for where undo is
 * withheld and BusbarStatusLine for which of the winner's keys did not come.
 */
import { useCallback, useMemo, useRef } from 'react';

import { useProgressView } from '../../canvasHost';
import { useLaneDrop } from '../../rowCanvas';
import { buildProjects } from './busbarModel';
import { BusbarSheet } from './BusbarSheet';
import { BusbarStatusLine } from './BusbarStatusLine';
import { BusbarStrip } from './BusbarStrip';
import { useBusbarKeys } from './useBusbarKeys';
import { useBusbarState } from './useBusbarState';
import './busbar.css';

export function BusbarCanvas() {
  const { model, canvas } = useProgressView();
  const rootRef = useRef<HTMLDivElement>(null);

  const projects = useMemo(
    () => buildProjects(model.rows, canvas.lanesByProject, model.allGoals ?? []),
    [model.rows, canvas.lanesByProject, model.allGoals],
  );
  const s = useBusbarState(projects);

  const newMilestone = useCallback(() => {
    if (s.project) canvas.startCreateMilestone(s.project.row.projectId);
  }, [s.project, canvas]);
  useBusbarKeys(rootRef, s, projects, newMilestone);

  // Busbar's own drop: the same drag contract as the other variants, but the
  // write goes through `s.wire`, so a drop is undoable like a key press. A
  // goal dropped on another project's rail is refused, not bound across.
  const { wire } = s;
  const drop = useLaneDrop(
    useCallback(
      (goalId: string, milestoneId: string | null) => {
        canvas.drag.onDragEnd();
        const owner = projects.find((p) => p.row.goals.some((g) => g.id === goalId));
        const band = owner?.bands.find((b) => (b.lane?.id ?? null) === milestoneId);
        // The open bus has no milestone id to check, so only the open sheet's
        // own goals may be dropped on it.
        if (!owner || (milestoneId ? !band : owner !== s.project)) return;
        void wire([goalId], milestoneId, band?.number ?? 0);
      },
      [canvas.drag, projects, wire, s.project],
    ),
  );

  return (
    <div ref={rootRef} className="bb" data-testid="goals-progress-busbar">
      {projects.map((p) =>
        p === s.project ? (
          <BusbarSheet key={p.row.projectId} project={p} projects={projects} s={s} drop={drop} />
        ) : (
          <BusbarStrip key={p.row.projectId} project={p} s={s} drop={drop} />
        ),
      )}
      <BusbarStatusLine s={s} projects={projects} />
    </div>
  );
}
