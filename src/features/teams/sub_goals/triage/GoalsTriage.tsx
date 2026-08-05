// Goal Triage — the ONE goal-acceptance surface (prototype winner, 2026-08-05).
//
// Metaphor: an inbox you clear. Decision-first — it opens on the goals that need
// a human, rendered as full-width action cards grouped under the KPI they serve
// (and, in the all-projects host, under a project heading). Everything else in
// scope folds into collapsed strips you expand only if you're curious.
//
// It replaced three surfaces: the canvas's inert GoalListPopover (titles, no
// actions), the modal prototype's Workbench and Board variants, and
// AcceptanceTriagePolished (the tray's own cross-project implementation). Two
// hosts feed it and nothing else renders goals for acceptance:
//   · MastermindGoalsModal — one project, from the canvas Goals cell
//   · GoalAcceptanceView   — every project, from the title-bar tray
//
// A pending goal's description is NEVER truncated: it is the thing you are
// being asked to judge. Only the collapsed context strips clamp.
import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, FolderGit2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { AcceptRejectControls } from '../acceptancePrimitives';
import { GoalStatusChip, GoalStatusDot, KpiGauge, TriageEmpty } from './triageBits';
import { bucketize, byLane, relTime, toRows, type GoalKpi, type GoalRow, type TriageGoal } from './triageModel';

export interface GoalsTriageProps {
  goals: TriageGoal[];
  kpis: GoalKpi[];
  /** Ids with an accept/reject in flight — their controls swap to a busy line. */
  busyIds: Set<string>;
  /** Print a project heading above each project's buckets (all-projects host). */
  groupByProject?: boolean;
  onAccept: (goalId: string) => void;
  onReject: (goalId: string, comment: string) => void;
  /** Bulk accept — one refetch for N accepts, not N racing refetch cycles. */
  onAcceptAll: (goalIds: string[]) => void;
}

export function GoalsTriage({ goals, kpis, busyIds, groupByProject, onAccept, onReject, onAcceptAll }: GoalsTriageProps) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const rows = toRows(goals, kpis);
  const pending = rows.filter((r) => r.awaiting);
  const lanes = byLane(rows);
  const inFlight = lanes.get('agent_turn') ?? [];
  // "Your turn" minus the awaiting ones = the open/blocked residue, which is
  // context here rather than a decision.
  const waiting = (lanes.get('your_turn') ?? []).filter((r) => !r.awaiting);
  const done = lanes.get('done') ?? [];
  const buckets = bucketize(pending, kpis, groupByProject);

  if (rows.length === 0) {
    return <TriageEmpty title={dl.triage_no_goals_title} body={dl.triage_no_goals_body} />;
  }

  let lastProject: string | null = null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-testid="goals-triage">
      {pending.length === 0 ? (
        <TriageEmpty
          title={dl.accept_empty_title}
          body={tx(dl.triage_all_clear_sub, { inflight: inFlight.length, done: done.length })}
        />
      ) : (
        <div className="px-4 pt-4 pb-2 space-y-5">
          <div className="flex items-center gap-3">
            <p className="typo-body text-foreground flex-1 min-w-0">
              {tx(pending.length === 1 ? dl.triage_headline_one : dl.triage_headline_other, { count: pending.length })}
            </p>
            {pending.length > 1 && (
              <button
                type="button"
                onClick={() => onAcceptAll(pending.map((r) => r.goal.id))}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-[var(--status-success)] bg-[var(--status-success)]/15 hover:bg-[var(--status-success)]/25 transition-colors shrink-0"
                data-testid="goals-triage-accept-all"
              >
                <Check className="w-3.5 h-3.5" /> {dl.accept_accept_all}
              </button>
            )}
          </div>

          {buckets.map((b, i) => {
            const showProject = Boolean(b.project) && b.project !== lastProject;
            lastProject = b.project;
            return (
              <section key={`${b.project ?? ''}:${b.kpi?.id ?? '__standalone'}:${i}`}>
                {showProject && (
                  <div className="flex items-center gap-2 pb-2">
                    <FolderGit2 className="w-4 h-4 text-primary shrink-0" aria-hidden />
                    <span className="typo-section-title truncate">{b.project}</span>
                  </div>
                )}
                {b.kpi ? (
                  <div className="flex items-center gap-3 pb-2">
                    <div className="max-w-[260px] flex-1"><KpiGauge kpi={b.kpi} /></div>
                    {b.kpi.offTrack && <span className="typo-label text-[var(--status-warning)] shrink-0">{dl.accept_off_track}</span>}
                    <span className="h-px flex-1 bg-primary/10" />
                    <span className="typo-caption text-foreground/70 tabular-nums">{b.rows.length}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 pb-2">
                    <span className="typo-label text-foreground/40">{dl.accept_standalone}</span>
                    <span className="h-px flex-1 bg-primary/10" />
                    <span className="typo-caption text-foreground/70 tabular-nums">{b.rows.length}</span>
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
            );
          })}
        </div>
      )}

      <div className="px-4 pb-4 pt-2 space-y-1">
        <ContextStrip label={t.plugins.dev_lifecycle.triage_lane_in_flight} rows={inFlight} />
        <ContextStrip label={t.plugins.dev_lifecycle.triage_strip_waiting} rows={waiting} />
        <ContextStrip label={t.plugins.dev_lifecycle.triage_lane_done} rows={done} />
      </div>
    </div>
  );
}

/** One decision. Title at 16px, the full description at body contrast — NOT
 *  clamped: a decision you can't read is a decision you can't make. */
function TriageCard({ row, busy, onAccept, onReject }: {
  row: GoalRow;
  busy: boolean;
  onAccept: (id: string) => void;
  onReject: (id: string, comment: string) => void;
}) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const finished = relTime(row.goal.completedAt);
  return (
    <li className="px-3 py-2.5 rounded-card bg-secondary/[0.15] hover:bg-secondary/25 transition-colors">
      <div className="flex items-start gap-2">
        <h4 className="typo-title-lg leading-snug break-words flex-1 min-w-0">{row.goal.title}</h4>
        {finished && (
          <span className="typo-caption text-foreground/70 tabular-nums shrink-0">{tx(dl.triage_ago, { time: finished })}</span>
        )}
      </div>
      {row.goal.description && (
        <p className="typo-body text-foreground leading-relaxed mt-1 whitespace-pre-wrap break-words">
          {row.goal.description}
        </p>
      )}
      <div className="mt-2">
        {busy
          ? <p className="typo-caption text-primary">{dl.triage_resolving}</p>
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
        {open ? <ChevronDown className="w-3.5 h-3.5 text-foreground/70" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground/70" />}
        <span className="typo-label text-foreground/40">{label}</span>
        <span className="typo-caption text-foreground/70 tabular-nums">{rows.length}</span>
        <span className="h-px flex-1 bg-primary/[0.07]" />
      </button>
      {open && (
        <ul className="pl-6 pr-2 pb-1 space-y-0.5">
          {rows.map((row) => (
            <li key={row.goal.id} className="flex items-center gap-2 py-1 min-w-0">
              <GoalStatusDot row={row} />
              <span className="typo-body text-foreground truncate flex-1 min-w-0">{row.goal.title}</span>
              <GoalStatusChip row={row} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
