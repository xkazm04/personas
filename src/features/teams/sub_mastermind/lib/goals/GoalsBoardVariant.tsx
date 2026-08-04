// VARIANT C — "Board". Metaphor: a pipeline you see end to end.
//
// Three fixed columns — Your turn · In flight · Done — each a scrollable stack
// of compact cards. Nothing is hidden behind a tab or a chevron: the shape of
// the project's goal flow (a fat middle column = a team that never finishes; a
// fat left column = a backlog nobody started) is legible in one glance, which
// neither predecessor could show at all.
//
// Acting happens IN PLACE: an awaiting card carries its own accept/reject strip
// rather than routing through a detail pane, so clearing four decisions is four
// clicks without ever changing what's on screen.
import { AcceptRejectControls } from '@/features/teams/sub_goals/acceptancePrimitives';

import { GoalStatusChip, GoalsEmpty, KpiTag } from './goalsModalBits';
import { byLane, LANES, relTime, toRows, type GoalRow, type GoalsModalProps } from './goalsModalModel';

export function GoalsBoardVariant({ goals, kpis, busyIds, onAccept, onReject, onAcceptAll }: GoalsModalProps) {
  const rows = toRows(goals, kpis);
  const lanes = byLane(rows);

  if (rows.length === 0) {
    return (
      <div className="flex-1 min-h-0">
        <GoalsEmpty title="No goals on this project" body="Goals appear here once a team or Athena writes them." />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-3 divide-x divide-primary/10">
      {LANES.map((laneMeta) => {
        const list = lanes.get(laneMeta.id) ?? [];
        const pending = list.filter((r) => r.awaiting);
        return (
          <section key={laneMeta.id} className="min-h-0 flex flex-col" data-testid={`mm-goal-lane-${laneMeta.id}`}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 flex-shrink-0">
              <span className="typo-label text-foreground/50">{laneMeta.label}</span>
              <span className="typo-caption text-muted-foreground tabular-nums">{list.length}</span>
              {pending.length > 1 && (
                <button
                  type="button"
                  onClick={() => onAcceptAll(pending.map((r) => r.goal.id))}
                  className="ml-auto typo-label text-[var(--status-success)] px-1.5 py-0.5 rounded-interactive bg-[var(--status-success)]/12 hover:bg-[var(--status-success)]/25 transition-colors"
                >
                  Accept {pending.length}
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {list.length === 0 ? (
                <p className="typo-caption text-muted-foreground px-1 pt-3">{laneMeta.blurb}</p>
              ) : (
                list.map((row) => (
                  <BoardCard
                    key={row.goal.id}
                    row={row}
                    busy={busyIds.has(row.goal.id)}
                    onAccept={onAccept}
                    onReject={onReject}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ row, busy, onAccept, onReject }: {
  row: GoalRow;
  busy: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string, comment: string) => void;
}) {
  const { goal } = row;
  const when = relTime(goal.completed_at) || relTime(goal.started_at);

  return (
    <article
      className="p-2.5 rounded-card bg-secondary/[0.16] hover:bg-secondary/25 transition-colors"
      // Left edge in the status tint — the card's identity mark, and the one
      // thing that stays legible when three columns are scanned at once.
      style={{ boxShadow: `inset 3px 0 0 0 ${row.tint}` }}
    >
      <h4 className="typo-title text-foreground leading-snug break-words">{goal.title}</h4>
      {goal.description && (
        <p className="typo-caption text-muted-foreground leading-snug mt-1 line-clamp-2">{goal.description}</p>
      )}

      {goal.progress > 0 && row.status !== 'done' && (
        <div className="mt-2 h-1 rounded-full overflow-hidden bg-primary/10">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, goal.progress)}%`, background: row.tint }} />
        </div>
      )}

      <div className="flex items-center gap-2 mt-2 min-w-0">
        <GoalStatusChip row={row} compact />
        {row.kpi && <KpiTag kpi={row.kpi} />}
        {when && <span className="ml-auto typo-caption text-muted-foreground tabular-nums shrink-0">{when}</span>}
      </div>

      {row.awaiting && (
        <div className="mt-2 pt-2 border-t border-primary/10">
          {busy
            ? <p className="typo-caption text-primary">Resolving…</p>
            : <AcceptRejectControls size="sm" onAccept={() => onAccept(goal.id)} onReject={(c) => onReject(goal.id, c)} />}
        </div>
      )}
    </article>
  );
}
