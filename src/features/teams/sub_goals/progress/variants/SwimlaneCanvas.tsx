/**
 * VARIANT 2 - SWIMLANE. THESIS: the row becomes a board. One lane per milestone
 * plus the unassigned lane, and where a goal SITS is what it is committed to.
 *
 * This is the literal reading of "each row as a canvas": the project is a
 * header, its cuts are the lanes beneath it, and the whole lane line is the drop
 * target, so a move is a short drag to a destination you can read. Nothing is
 * encoded in a 20px flag that a name could carry instead.
 *
 * What it trades: the portfolio no longer reads in one viewsight. A project with
 * four cuts is five lines tall, so comparing timing ACROSS projects - the thing
 * the filmstrip exists for - now needs scrolling. Chronological order survives
 * inside each lane, which keeps the frames meaningful but makes the "now" rule
 * unplaceable, so it is gone: a lane is a scope, not a timeline.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { AddGoalButton, NODE_PX } from '../../progressShared';
import { AddLaneButton, CanvasFrame, LaneChip, UnassignedLane } from '../canvasParts';
import { useProgressView } from '../canvasHost';
import { useMenuKey } from '../rowCanvas';
import type { ProgressNode, ProgressRow } from '../useProgressModel';

export function SwimlaneCanvas() {
  const { model } = useProgressView();
  return (
    <>
      {model.rows.map((row) => (
        <SwimlaneRow key={row.projectId} row={row} />
      ))}
    </>
  );
}

function SwimlaneRow({ row }: { row: ProgressRow }) {
  const { canvas, dl, createGoalIn } = useProgressView();
  const { onKeyDown, onContextMenu } = useMenuKey((e) =>
    canvas.openMenu(e, { kind: 'project', projectId: row.projectId, name: row.name }),
  );
  const lanes = canvas.lanesByProject?.get(row.projectId) ?? null;
  const boundIds = new Set(lanes?.flatMap((l) => [...l.goalIds]) ?? []);
  const unassigned = row.nodes.filter((n) => !boundIds.has(n.goal.id));

  return (
    <div
      data-testid={`progress-row-${row.projectId}`}
      className="border-b border-primary/5 last:border-b-0"
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      {/* Project head. The emphasis of the row sits here, once, on the name. */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/20 border-b border-primary/5">
        <Tooltip content={row.name}>
          <span className="typo-label text-foreground truncate min-w-0">{row.name}</span>
        </Tooltip>
        <span className="typo-caption text-foreground tabular-nums shrink-0">{row.goals.length}</span>
        <span className="flex-1" />
        <AddGoalButton projectName={row.name} label={dl.goal_new_title} onClick={() => createGoalIn(row.projectId)} />
        <AddLaneButton projectId={row.projectId} />
      </div>

      {/* Lanes arrive as their own region: until they do the project shows its
          one honest lane, everything unassigned. No placeholder - the goals are
          already drawn and a skeleton over them would hide real rows. */}
      {lanes?.map((lane) => (
        <LaneLine
          key={lane.id}
          laneKey={lane.id}
          milestoneId={lane.id}
          head={
            <LaneChip
              lane={lane}
              asDropTarget={false}
              count={row.goals.filter((g) => lane.goalIds.has(g.id)).length}
            />
          }
          nodes={row.nodes.filter((n) => lane.goalIds.has(n.goal.id))}
          projectId={row.projectId}
          laneStatus={lane.status}
        />
      ))}

      <UnassignedLane projectId={row.projectId} count={unassigned.length}>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {unassigned.map((n) => (
            <CanvasFrame key={n.goal.id} node={n} projectId={row.projectId} dl={dl} bound={false} laneStatus={null} />
          ))}
        </div>
      </UnassignedLane>
    </div>
  );
}

function LaneLine({
  laneKey,
  milestoneId,
  head,
  nodes,
  projectId,
  laneStatus,
}: {
  laneKey: string;
  milestoneId: string;
  head: React.ReactNode;
  nodes: ProgressNode[];
  projectId: string;
  laneStatus: string;
}) {
  const { canvas, dl } = useProgressView();
  const over = canvas.drop.overKey === laneKey;
  return (
    <div
      {...canvas.drop.propsFor(laneKey, milestoneId)}
      data-testid={`progress-lane-${laneKey}`}
      className={`flex items-start gap-2.5 px-3 py-1.5 border-b border-primary/5 last:border-b-0 transition-colors ${
        over ? 'bg-primary/[0.07]' : ''
      }`}
      style={{ minHeight: NODE_PX + 12 }}
    >
      <div className="shrink-0 pt-px">{head}</div>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
        {nodes.map((n) => (
          <CanvasFrame key={n.goal.id} node={n} projectId={projectId} dl={dl} bound laneStatus={laneStatus} />
        ))}
      </div>
    </div>
  );
}
