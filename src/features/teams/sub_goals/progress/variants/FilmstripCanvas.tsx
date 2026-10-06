/**
 * VARIANT 1 - FILMSTRIP. THESIS: chronology stays the spine; a milestone is a
 * labelled drop zone in the row's own margin and a bound goal flies a flag.
 *
 * This is the CURRENT view, kept as the baseline so the other two are compared
 * against the real thing rather than against a description of it. What is new
 * is the second line of each row: the project's milestones as chips, each a
 * drop target, plus the unassigned lane and the button that creates a cut. The
 * frames themselves keep their date order, so the one thing this layout is good
 * at - seeing a whole portfolio's timing at once - is not traded away for scope.
 *
 * The cost it accepts: WHICH cut a goal belongs to is not legible at a glance.
 * The flag says "committed", its tone says "planned / cut / shipped", and the
 * name needs the menu. That is the honest limit of a 20px frame.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { AddGoalButton, NODE_PX } from '../../progressShared';
import { AddLaneButton, CanvasFrame, LaneChip, UnassignedLane } from '../canvasParts';
import { useProgressView } from '../canvasHost';
import { useMenuKey } from '../rowCanvas';
import type { ProgressRow } from '../useProgressModel';

export function FilmstripCanvas({ leftWidth }: { leftWidth: number }) {
  const { model } = useProgressView();
  return (
    <>
      {model.rows.map((row) => (
        <FilmstripRow key={row.projectId} row={row} leftWidth={leftWidth} />
      ))}
    </>
  );
}

function FilmstripRow({ row, leftWidth }: { row: ProgressRow; leftWidth: number }) {
  const { model, canvas, dl, createGoalIn } = useProgressView();
  const { onKeyDown, onContextMenu } = useMenuKey((e) =>
    canvas.openMenu(e, { kind: 'project', projectId: row.projectId, name: row.name }),
  );
  const lanes = canvas.lanesByProject?.get(row.projectId) ?? null;
  const boundIds = new Set(lanes?.flatMap((l) => [...l.goalIds]) ?? []);
  const laneOf = (goalId: string) => lanes?.find((l) => l.goalIds.has(goalId)) ?? null;

  const frames = (nodes: ProgressRow['past']) =>
    nodes.map((n) => (
      <CanvasFrame
        key={n.goal.id}
        node={n}
        projectId={row.projectId}
        dl={dl}
        bound={boundIds.has(n.goal.id)}
        laneStatus={laneOf(n.goal.id)?.status ?? null}
      />
    ));

  return (
    <div
      data-testid={`progress-row-${row.projectId}`}
      className="flex items-stretch border-b border-primary/5 last:border-b-0 transition-colors hover:bg-primary/[0.03]"
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div
        className="shrink-0 px-3 py-2.5 flex flex-col justify-center min-w-0 border-r border-primary/5"
        style={{ width: leftWidth }}
      >
        <Tooltip content={row.name}>
          <span className="typo-body text-foreground truncate">{row.name}</span>
        </Tooltip>
      </div>

      <div className="flex-1 min-w-0 px-3 py-2.5 flex flex-col gap-2">
        {/* The strip: uniform-pitch frames in chronological order, wrapping. */}
        <div className="flex flex-wrap items-center content-center gap-1.5" style={{ minHeight: NODE_PX + 4 }}>
          {frames(row.past)}
          <Tooltip content={dl.progress_today}>
            <span aria-hidden="true" className="w-0.5 rounded-full bg-violet-400/70 mx-0.5" style={{ height: NODE_PX }} />
          </Tooltip>
          {frames(row.future)}
          {row.undated.some((n) => !model.hiddenIds.has(n.goal.id)) && (
            <Tooltip content={dl.progress_no_date}>
              <span aria-hidden="true" className="border-l border-dashed border-primary/30 mx-0.5" style={{ height: NODE_PX }} />
            </Tooltip>
          )}
          {frames(row.undated)}
          <AddGoalButton projectName={row.name} label={dl.goal_new_title} onClick={() => createGoalIn(row.projectId)} />
        </div>

        {/* The scope margin. Absent until the lanes arrive: the goals above are
            the surface and a placeholder here would be noise on every row. */}
        {lanes !== null && (
          <div className="flex flex-wrap items-center gap-1.5">
            {lanes.map((lane) => (
              <LaneChip
                key={lane.id}
                lane={lane}
                dense
                count={row.goals.filter((g) => lane.goalIds.has(g.id)).length}
              />
            ))}
            <UnassignedLane projectId={row.projectId} count={row.goals.filter((g) => !boundIds.has(g.id)).length} />
            <AddLaneButton projectId={row.projectId} />
          </div>
        )}
      </div>
    </div>
  );
}
