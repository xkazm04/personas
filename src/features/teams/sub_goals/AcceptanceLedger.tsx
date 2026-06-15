// Variant 1 — LEDGER. The strict acceptance matrix: a fixed header row of team
// columns, KPI group bands spanning the width, and one row per completed goal
// with its card seated in its team's column (other cells dimmed). The mental
// model is an accountant's ledger — scan a team's column to see everything it
// shipped, scan a band to see everything bidding to move one KPI. Dense,
// tabular, hairline-separated; counts everywhere.
import { Clock, GitPullRequest } from 'lucide-react';

import type { PendingGoal, PendingKpi, PendingTeam } from './goalAcceptanceMock';
import { groupByKpi, countByTeam } from './goalAcceptanceMock';
import {
  AcceptRejectControls, EmptyCell, KpiGroupHeader, TeamColumnHeader, wash,
} from './acceptancePrimitives';

interface Props {
  goals: PendingGoal[];
  teams: PendingTeam[];
  kpis: PendingKpi[];
  onAccept: (goalId: string) => void;
  onReject: (goalId: string, comment: string) => void;
}

export function AcceptanceLedger({ goals, teams, kpis, onAccept, onReject }: Props) {
  const groups = groupByKpi(goals, kpis);
  const counts = countByTeam(goals);
  const cols = { gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))` };

  return (
    <div className="rounded-card border border-primary/10 overflow-hidden">
      {/* Team column headers */}
      <div className="grid gap-px bg-primary/5 border-b border-primary/10 px-2 py-2" style={cols}>
        {teams.map((team) => (
          <div key={team.id} className="px-2">
            <TeamColumnHeader team={team} count={counts.get(team.id) ?? 0} />
          </div>
        ))}
      </div>

      {groups.map((group) => (
        <div key={group.kpi?.id ?? 'standalone'} className="border-b border-primary/10 last:border-0">
          {/* KPI band */}
          <div className="px-3 py-2 bg-secondary/15 border-b border-primary/5">
            <KpiGroupHeader kpi={group.kpi} ready={group.goals.length} />
          </div>

          {/* One row per goal — card seated in its team's column */}
          {group.goals.map((goal) => (
            <div key={goal.id} className="grid gap-px px-2 py-1.5 hover:bg-secondary/10 transition-colors" style={cols}>
              {teams.map((team) => {
                if (team.id !== goal.teamId) return <EmptyCell key={team.id} />;
                return (
                  <div
                    key={team.id}
                    className="rounded-interactive border border-primary/10 bg-card/40 p-2.5"
                    style={{ boxShadow: `inset 3px 0 0 0 ${team.color}` }}
                  >
                    <h4 className="typo-card-label leading-snug break-words mb-1">{goal.title}</h4>
                    <p className="typo-caption text-foreground/70 leading-snug line-clamp-2 mb-2">{goal.summary}</p>
                    <div className="flex items-center gap-3 mb-2 typo-caption text-foreground/50">
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{goal.completedAt}</span>
                      <span className="inline-flex items-center gap-1 tabular-nums"><GitPullRequest className="w-3 h-3" />{goal.prs} PRs</span>
                    </div>
                    <AcceptRejectControls
                      size="sm"
                      onAccept={() => onAccept(goal.id)}
                      onReject={(c) => onReject(goal.id, c)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}

      {groups.length === 0 && <EmptyQueue />}
      {/* faint team-color legend strip so columns are decodable without scanning */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-secondary/10">
        {teams.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5 typo-caption text-foreground/60">
            <span className="w-2 h-2 rounded-full" style={{ background: wash(t.color, 80) }} />
            {t.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function EmptyQueue() {
  return (
    <div className="py-12 text-center">
      <p className="typo-title text-foreground/80">Nothing waiting on you</p>
      <p className="typo-caption text-foreground/50 mt-1">Completed goals appear here for your acceptance.</p>
    </div>
  );
}
