// Winner — TRIAGE, polished. Keeps the Triage interaction (collapsible groups,
// per-group Accept all, inline reject-with-comment) but fixes the two things the
// baseline got wrong:
//   1. GROUPING — goals now group by PROJECT (top section) with KPI demoted to a
//      thin uppercase sub-divider, the hierarchy the user asked for.
//   2. TYPOGRAPHY — a real reading ladder instead of one flat 14px tier:
//        Project   typo-section-title (18px)   — the section anchor
//        Goal title typo-title-lg     (16px/600) — the PRIMARY read, a real size jump
//        Summary   typo-body          (14px/400, FULL contrast) — readable prose, not muted caption
//        Meta      typo-caption       (14px muted) — recedes
//        KPI label typo-label         (12px uppercase) — sub-divider marker
//      (typo-* tokens are unlayered — weight/colour can't be patched via utilities,
//       so each role uses the token that already carries the right size+weight+colour.)
// No borders/outlines anywhere — fills + hairlines only.
import { useState } from 'react';
import { ChevronDown, ChevronRight, Check, FolderGit2, Clock, GitPullRequest } from 'lucide-react';

import type { PendingGoal, PendingProject, PendingTeam, PendingKpi } from './goalAcceptanceMock';
import { groupByProjectThenKpi } from './goalAcceptanceMock';
import { AcceptRejectControls, KpiDivider, TeamMonogram, EmptyQueue } from './acceptancePrimitives';

interface Props {
  goals: PendingGoal[];
  teams: PendingTeam[];
  kpis: PendingKpi[];
  projects: PendingProject[];
  onAccept: (goalId: string) => void;
  onReject: (goalId: string, comment: string) => void;
}

export function AcceptanceTriagePolished({ goals, teams, kpis, projects, onAccept, onReject }: Props) {
  const grouped = groupByProjectThenKpi(goals, kpis, projects);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (grouped.length === 0) return <EmptyQueue />;

  const teamCount = new Set(goals.map((g) => g.teamId)).size;
  const kpiCount = new Set(goals.filter((g) => g.kpiId).map((g) => g.kpiId)).size;

  return (
    <div className="space-y-6">
      {/* Standfirst — a quiet context line, no box */}
      <p className="typo-body text-muted-foreground">
        <span className="text-foreground font-semibold tabular-nums">{goals.length}</span> completed goals
        await your acceptance · {teamCount} teams · {kpiCount} KPIs
      </p>

      {grouped.map((pg) => {
        const isCollapsed = collapsed.has(pg.project.id);
        return (
          <section key={pg.project.id}>
            {/* Project header — the section anchor (18px), folder mark, rollup, Accept all */}
            <div className="flex items-center gap-2.5 pb-2">
              <button type="button" onClick={() => toggle(pg.project.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left group">
                {isCollapsed ? <ChevronRight className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                <FolderGit2 className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="typo-section-title truncate">{pg.project.name}</span>
                <span className="typo-caption text-muted-foreground truncate">{pg.project.stack}</span>
                <span className="typo-caption text-muted-foreground tabular-nums shrink-0">{pg.total} goals · {pg.teams} teams</span>
              </button>
              <button
                type="button"
                onClick={() => pg.kpiGroups.flatMap((kg) => kg.goals).forEach((g) => onAccept(g.id))}
                className="inline-flex items-center gap-1.5 typo-caption font-medium rounded-interactive px-2.5 py-1 text-[var(--success)] bg-[var(--success)]/15 hover:bg-[var(--success)]/25 transition-colors shrink-0"
              >
                <Check className="w-3.5 h-3.5" /> Accept all
              </button>
            </div>
            <div className="h-px bg-primary/15" />

            {!isCollapsed && pg.kpiGroups.map((kg) => (
              <div key={kg.kpi?.id ?? `${pg.project.id}-standalone`}>
                <KpiDivider kpi={kg.kpi} count={kg.goals.length} />
                <ul className="space-y-0.5">
                  {kg.goals.map((goal) => {
                    const team = teamById.get(goal.teamId);
                    return (
                      <li key={goal.id} className="flex gap-3 px-2 py-2.5 rounded-interactive hover:bg-secondary/15 transition-colors">
                        {team && <span className="mt-0.5 shrink-0"><TeamMonogram team={team} size={26} /></span>}
                        <div className="min-w-0 flex-1">
                          {/* PRIMARY READ — 16px headline */}
                          <h4 className="typo-title-lg leading-snug break-words">{goal.title}</h4>
                          {/* SECONDARY — full-contrast readable prose */}
                          <p className="typo-body text-foreground leading-relaxed mt-1 line-clamp-2">{goal.summary}</p>
                          {/* TERTIARY (meta, muted) + actions; reject box wraps full-width */}
                          <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
                            <span className="typo-caption text-muted-foreground inline-flex items-center gap-3">
                              <span style={{ color: team?.color }}>{team?.name}</span>
                              <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{goal.completedAt}</span>
                              <span className="inline-flex items-center gap-1 tabular-nums"><GitPullRequest className="w-3 h-3" />{goal.prs} PRs</span>
                            </span>
                            <AcceptRejectControls size="sm" onAccept={() => onAccept(goal.id)} onReject={(c) => onReject(goal.id, c)} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
