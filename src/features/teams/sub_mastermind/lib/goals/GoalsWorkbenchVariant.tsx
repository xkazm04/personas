// VARIANT A — "Workbench". Metaphor: a bench you pick a piece up on.
//
// Deliberately the closest sibling of SkillsWorkbench (the modal the operator
// named as the quality bar): a lane-segmented title rail on the left, one goal's
// full record on the right. Different from the baseline popover in that the list
// is no longer the payload — it's an INDEX, and the detail pane is where the
// goal's description, KPI reading, progress and accept/reject decision live.
//
// Why this direction: goals carry prose (description, rejection feedback) that a
// row can never show without shredding the list. A detail pane is the only shape
// that lets you actually READ a goal before deciding on it.
import { useEffect, useState } from 'react';

import { AcceptRejectControls } from '@/features/teams/sub_goals/acceptancePrimitives';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import type { GoalLane } from '@/features/teams/sub_goals/goalStatus';

import { GoalStatusChip, GoalStatusDot, GoalsEmpty, KpiGauge, KpiTag } from './goalsModalBits';
import { byLane, LANES, relTime, toRows, type GoalRow, type GoalsModalProps } from './goalsModalModel';

export function GoalsWorkbenchVariant({ goals, kpis, busyIds, onAccept, onReject, onAcceptAll }: GoalsModalProps) {
  const rows = toRows(goals, kpis);
  const lanes = byLane(rows);
  // Open on the lane that has something for the user, so the modal never lands
  // on an empty rail when work is waiting one tab over.
  const firstFilled = LANES.find((l) => (lanes.get(l.id)?.length ?? 0) > 0)?.id ?? 'your_turn';
  const [lane, setLane] = useState<GoalLane>(firstFilled);
  const [selected, setSelected] = useState<string | null>(null);

  const list = lanes.get(lane) ?? [];
  useEffect(() => { setSelected(null); }, [lane]);
  const active = list.find((r) => r.goal.id === selected) ?? null;
  const laneMeta = LANES.find((l) => l.id === lane);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 border-b border-primary/10 flex-shrink-0">
        <SegmentedTabs
          tabs={LANES.map((l) => ({ id: l.id, label: `${l.label} · ${lanes.get(l.id)?.length ?? 0}` }))}
          activeTab={lane}
          onTabChange={(v) => setLane(v as GoalLane)}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel="Goal lane"
        />
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-h-0 border-r border-primary/10 overflow-y-auto">
          {list.length === 0 ? (
            <GoalsEmpty title="Nothing in this lane" body={laneMeta?.blurb ?? ''} />
          ) : (
            <ul className="p-1.5 space-y-0.5">
              {list.map((row) => (
                <li key={row.goal.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.goal.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-interactive transition-colors focus-ring ${
                      selected === row.goal.id ? 'bg-primary/12' : 'hover:bg-secondary/25'
                    }`}
                    data-testid={`mm-goal-row-${row.goal.id}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <GoalStatusDot row={row} />
                      <span className="typo-body text-foreground truncate">{row.goal.title}</span>
                    </span>
                    {row.kpi && <span className="flex mt-1 pl-4"><KpiTag kpi={row.kpi} /></span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {active ? (
            <GoalDetail row={active} busy={busyIds.has(active.goal.id)} onAccept={onAccept} onReject={onReject} />
          ) : (
            <GoalsEmpty
              title="Pick a goal"
              body={laneMeta?.blurb ?? 'Select a goal on the left to read it and act on it.'}
            />
          )}
        </div>
      </div>

      <LaneFooter lane={lane} rows={list} onAcceptAll={onAcceptAll} />
    </div>
  );
}

function GoalDetail({ row, busy, onAccept, onReject }: {
  row: GoalRow;
  busy: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string, comment: string) => void;
}) {
  const { goal } = row;
  const finished = relTime(goal.completed_at);
  const started = relTime(goal.started_at);

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <h3 className="typo-title-lg text-foreground flex-1 min-w-0 break-words">{goal.title}</h3>
          <GoalStatusChip row={row} />
        </div>
        <p className="typo-caption text-muted-foreground tabular-nums">
          {finished ? `finished ${finished}` : started ? `started ${started}` : 'not started'}
          {goal.progress > 0 && ` · ${Math.round(goal.progress)}% progress`}
        </p>
      </div>

      {goal.description ? (
        <p className="typo-body text-foreground leading-relaxed whitespace-pre-wrap">{goal.description}</p>
      ) : (
        <p className="typo-body text-muted-foreground italic">No description recorded for this goal.</p>
      )}

      {row.kpi && (
        <div className="p-3 rounded-card bg-secondary/[0.18]">
          <p className="typo-label text-foreground/40 mb-2">Serves</p>
          <KpiGauge kpi={row.kpi} />
        </div>
      )}

      {row.awaiting && (
        <div className="pt-1 border-t border-primary/10">
          <p className="typo-caption text-muted-foreground mb-2">
            The team says this is finished. Accept it to close the goal, or send it back with what still needs doing.
          </p>
          {busy ? (
            <p className="typo-caption text-primary">Resolving…</p>
          ) : (
            <AcceptRejectControls onAccept={() => onAccept(goal.id)} onReject={(c) => onReject(goal.id, c)} />
          )}
        </div>
      )}
    </div>
  );
}

/** Bulk affordance, scoped to the visible lane — never a hidden global accept. */
function LaneFooter({ lane, rows, onAcceptAll }: {
  lane: GoalLane;
  rows: GoalRow[];
  onAcceptAll: (ids: string[]) => void;
}) {
  const pending = rows.filter((r) => r.awaiting);
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
      <span className="typo-label text-foreground/35">
        {rows.length} in {LANES.find((l) => l.id === lane)?.label.toLowerCase()}
      </span>
      {pending.length > 1 && (
        <button
          type="button"
          onClick={() => onAcceptAll(pending.map((r) => r.goal.id))}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-[var(--status-success)] bg-[var(--status-success)]/15 hover:bg-[var(--status-success)]/25 transition-colors"
        >
          Accept all {pending.length}
        </button>
      )}
    </div>
  );
}
