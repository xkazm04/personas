// Variant 3 — TRIAGE CONSOLE. Optimised for throughput: a summary bar up top,
// KPI sections that collapse, a per-section "Accept all" batch action, and
// compact one-line goal rows you can sweep accept/reject. The team is a
// positioned monogram (column identity without a sparse matrix), so a long
// queue stays dense. The mental model is an inbox you clear, not a spreadsheet
// you study — the opposite end of the spectrum from the Ledger.
import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, Inbox } from 'lucide-react';

import type { PendingGoal, PendingKpi, PendingTeam } from './goalAcceptanceMock';
import { groupByKpi } from './goalAcceptanceMock';
import { AcceptRejectControls, KpiMiniGauge, TeamMonogram } from './acceptancePrimitives';
import { EmptyQueue } from './AcceptanceLedger';

interface Props {
  goals: PendingGoal[];
  teams: PendingTeam[];
  kpis: PendingKpi[];
  onAccept: (goalId: string) => void;
  onReject: (goalId: string, comment: string) => void;
}

export function AcceptanceTriage({ goals, teams, kpis, onAccept, onReject }: Props) {
  const groups = groupByKpi(goals, kpis);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (groups.length === 0) return <EmptyQueue />;

  const teamCount = new Set(goals.map((g) => g.teamId)).size;
  const kpiLinked = goals.filter((g) => g.kpiId).length;
  const kpiCount = new Set(goals.filter((g) => g.kpiId).map((g) => g.kpiId)).size;

  return (
    <div className="space-y-3">
      {/* Summary bar — the "how much is waiting on me" headline */}
      <div className="flex items-center gap-2 rounded-card border border-primary/10 bg-secondary/15 px-3.5 py-2.5">
        <Inbox className="w-4 h-4 text-violet-400 shrink-0" />
        <p className="typo-body text-foreground">
          <span className="font-semibold tabular-nums">{goals.length}</span> goals from{' '}
          <span className="font-semibold tabular-nums">{teamCount}</span> teams awaiting you
          <span className="text-foreground/55">
            {' '}· <span className="tabular-nums">{kpiLinked}</span> linked to{' '}
            <span className="tabular-nums">{kpiCount}</span> KPIs
          </span>
        </p>
      </div>

      {groups.map((group) => {
        const gid = group.kpi?.id ?? 'standalone';
        const isCollapsed = collapsed.has(gid);
        return (
          <div key={gid} className="rounded-card border border-primary/10 overflow-hidden">
            {/* Section header — rollup + collapse + batch accept */}
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/15">
              <button type="button" onClick={() => toggle(gid)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-foreground/50" /> : <ChevronDown className="w-3.5 h-3.5 text-foreground/50" />}
                <span className="typo-label text-foreground truncate">
                  {group.kpi ? group.kpi.name : 'Standalone'}
                </span>
                {group.kpi?.offTrack && (
                  <span className="typo-caption px-1.5 py-0.5 rounded-full text-[var(--destructive)] border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 shrink-0">
                    off track
                  </span>
                )}
                <span className="typo-caption text-foreground/50 tabular-nums shrink-0">{group.goals.length}</span>
              </button>
              {group.kpi && <KpiMiniGauge kpi={group.kpi} width={120} />}
              <button
                type="button"
                onClick={() => group.goals.forEach((g) => onAccept(g.id))}
                className="inline-flex items-center gap-1 typo-caption rounded-interactive px-2 py-1 text-[var(--success)] border border-[var(--success)]/30 bg-[var(--success)]/10 hover:bg-[var(--success)]/20 transition-colors shrink-0"
              >
                <Check className="w-3.5 h-3.5" /> Accept all
              </button>
            </div>

            {/* Compact goal rows */}
            {!isCollapsed && (
              <ul className="divide-y divide-primary/5">
                {group.goals.map((goal) => {
                  const team = teamById.get(goal.teamId);
                  return (
                    <li key={goal.id} className="flex items-start gap-3 px-3 py-2.5 hover:bg-secondary/10 transition-colors">
                      {team && <span className="mt-0.5"><TeamMonogram team={team} size={20} /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="typo-card-label text-foreground leading-snug break-words">{goal.title}</p>
                        <p className="typo-caption text-foreground/60 leading-snug line-clamp-1">{goal.summary}</p>
                        <p className="typo-caption text-foreground/40 mt-0.5">
                          {team?.name} · {goal.completedAt} · {goal.prs} PRs
                        </p>
                      </div>
                      <div className="shrink-0 w-[var(--triage-actions,auto)]">
                        <AcceptRejectControls size="sm" onAccept={() => onAccept(goal.id)} onReject={(c) => onReject(goal.id, c)} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
