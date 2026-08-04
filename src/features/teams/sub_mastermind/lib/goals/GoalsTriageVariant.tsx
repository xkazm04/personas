// VARIANT B — "Triage". Metaphor: an inbox you clear.
//
// Decision-first. The modal opens on the goals that need a human, rendered as
// full-width action cards grouped under their KPI (the acceptance queue's own
// reading ladder — 16px title, full-contrast summary, thin uppercase KPI
// divider — scoped down to ONE project). Everything else in the project is
// folded below into two collapsed strips you expand only if you're curious.
//
// Why this direction: the Goals cell on the canvas exists to tell you something
// needs you. Opening straight into "here are the N decisions, in reading order,
// with Accept under your thumb" is the shortest path from that signal to zero
// pending goals. The rest of the project's goals are context, not payload.
import { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';

import { AcceptRejectControls } from '@/features/teams/sub_goals/acceptancePrimitives';

import { GoalStatusChip, GoalStatusDot, GoalsEmpty, KpiGauge } from './goalsModalBits';
import { byKpi, byLane, relTime, toRows, type GoalRow, type GoalsModalProps } from './goalsModalModel';

export function GoalsTriageVariant({ goals, kpis, busyIds, onAccept, onReject, onAcceptAll }: GoalsModalProps) {
  const rows = toRows(goals, kpis);
  const pending = rows.filter((r) => r.awaiting);
  const lanes = byLane(rows);
  const inFlight = lanes.get('agent_turn') ?? [];
  // "Your turn" minus the awaiting ones = the open/blocked residue, which is
  // context here rather than a decision.
  const waiting = (lanes.get('your_turn') ?? []).filter((r) => !r.awaiting);
  const done = lanes.get('done') ?? [];
  const buckets = byKpi(pending, kpis);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {pending.length === 0 ? (
        <div className="h-full">
          <GoalsEmpty
            title="Nothing needs you"
            body={`${inFlight.length} goal${inFlight.length === 1 ? '' : 's'} in flight, ${done.length} done. Expand a strip below to see them.`}
          />
        </div>
      ) : (
        <div className="px-4 pt-4 pb-2 space-y-5">
          <div className="flex items-center gap-3">
            <p className="typo-body text-foreground flex-1 min-w-0">
              <span className="typo-title-lg">{pending.length}</span>
              {pending.length === 1 ? ' goal is finished and waiting on your call.' : ' goals are finished and waiting on your call.'}
            </p>
            {pending.length > 1 && (
              <button
                type="button"
                onClick={() => onAcceptAll(pending.map((r) => r.goal.id))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-[var(--status-success)] bg-[var(--status-success)]/15 hover:bg-[var(--status-success)]/25 transition-colors shrink-0"
              >
                <Check className="w-3.5 h-3.5" /> Accept all
              </button>
            )}
          </div>

          {buckets.map((b) => (
            <section key={b.kpi?.id ?? '__standalone'}>
              {b.kpi ? (
                <div className="flex items-center gap-3 pb-2">
                  <div className="max-w-[260px] flex-1"><KpiGauge kpi={b.kpi} /></div>
                  <span className="h-px flex-1 bg-primary/10" />
                  <span className="typo-caption text-muted-foreground tabular-nums">{b.rows.length}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 pb-2">
                  <span className="typo-label text-foreground/40">Standalone</span>
                  <span className="h-px flex-1 bg-primary/10" />
                  <span className="typo-caption text-muted-foreground tabular-nums">{b.rows.length}</span>
                </div>
              )}
              <ul className="space-y-1">
                {b.rows.map((row) => (
                  <TriageCard
                    key={row.goal.id}
                    row={row}
                    busy={busyIds.has(row.goal.id)}
                    onAccept={onAccept}
                    onReject={onReject}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="px-4 pb-4 pt-2 space-y-1">
        <ContextStrip label="In flight" rows={inFlight} />
        <ContextStrip label="Waiting to start" rows={waiting} />
        <ContextStrip label="Done" rows={done} />
      </div>
    </div>
  );
}

/** One decision. The reading ladder is the acceptance queue's: title at 16px,
 *  description at full contrast (not a muted caption), meta receding. */
function TriageCard({ row, busy, onAccept, onReject }: {
  row: GoalRow;
  busy: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string, comment: string) => void;
}) {
  const finished = relTime(row.goal.completed_at);
  return (
    <li className="px-3 py-2.5 rounded-card bg-secondary/[0.15] hover:bg-secondary/25 transition-colors">
      <div className="flex items-start gap-2">
        <h4 className="typo-title-lg leading-snug break-words flex-1 min-w-0">{row.goal.title}</h4>
        {finished && <span className="typo-caption text-muted-foreground tabular-nums shrink-0">{finished}</span>}
      </div>
      {row.goal.description && (
        <p className="typo-body text-foreground leading-relaxed mt-1 line-clamp-2">{row.goal.description}</p>
      )}
      <div className="mt-2">
        {busy
          ? <p className="typo-caption text-primary">Resolving…</p>
          : <AcceptRejectControls size="sm" onAccept={() => onAccept(row.goal.id)} onReject={(c) => onReject(row.goal.id, c)} />}
      </div>
    </li>
  );
}

/** A collapsed strip of non-actionable goals — one line until you open it. */
function ContextStrip({ label, rows }: { label: string; rows: GoalRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive hover:bg-secondary/20 transition-colors focus-ring"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="typo-label text-foreground/40">{label}</span>
        <span className="typo-caption text-muted-foreground tabular-nums">{rows.length}</span>
        <span className="h-px flex-1 bg-primary/[0.07]" />
      </button>
      {open && (
        <ul className="pl-6 pr-2 pb-1 space-y-0.5">
          {rows.map((row) => (
            <li key={row.goal.id} className="flex items-center gap-2 py-1 min-w-0">
              <GoalStatusDot row={row} />
              <span className="typo-body text-foreground/70 truncate flex-1 min-w-0">{row.goal.title}</span>
              <GoalStatusChip row={row} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
