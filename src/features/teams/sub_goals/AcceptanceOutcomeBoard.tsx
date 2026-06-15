// Variant 2 — OUTCOME BOARD. Each KPI is an elevated cluster panel with its
// gauge as the hero; the completed goals sit in team columns *inside* the panel,
// so the reading is "these shipped goals are bidding to move THIS outcome — did
// they?". Card-forward and spacious (vs the Ledger's dense matrix); the KPI is
// the protagonist, the team is a column within its story. Mirrors the goalsTheme
// panel treatment so it reads as a sibling of the Board/Map.
import { Clock, GitPullRequest, FolderGit2 } from 'lucide-react';

import { GOAL_PANEL, GoalAtmosphere } from './goalsTheme';
import type { PendingGoal, PendingKpi, PendingTeam } from './goalAcceptanceMock';
import { groupByKpi, kpiPct } from './goalAcceptanceMock';
import { AcceptRejectControls, KpiMiniGauge, TeamMonogram, wash } from './acceptancePrimitives';
import { EmptyQueue } from './AcceptanceLedger';

interface Props {
  goals: PendingGoal[];
  teams: PendingTeam[];
  kpis: PendingKpi[];
  onAccept: (goalId: string) => void;
  onReject: (goalId: string, comment: string) => void;
}

export function AcceptanceOutcomeBoard({ goals, teams, kpis, onAccept, onReject }: Props) {
  const groups = groupByKpi(goals, kpis);
  const cols = { gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))` };

  if (groups.length === 0) return <EmptyQueue />;

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const accent = group.kpi ? (group.kpi.offTrack ? 'var(--destructive)' : 'var(--success)') : 'var(--primary)';
        const pct = group.kpi ? kpiPct(group.kpi) : 0;
        return (
          <section key={group.kpi?.id ?? 'standalone'} className={`relative overflow-hidden ${GOAL_PANEL} p-4`}>
            <GoalAtmosphere />
            {/* Panel header — the KPI is the hero */}
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  {group.kpi ? (
                    <span className="typo-section-title text-foreground truncate">{group.kpi.name}</span>
                  ) : (
                    <span className="typo-section-title text-foreground/80 inline-flex items-center gap-2">
                      <FolderGit2 className="w-4 h-4 text-primary/60" /> Standalone goals
                    </span>
                  )}
                  {group.kpi?.offTrack && (
                    <span className="typo-caption px-1.5 py-0.5 rounded-full text-[var(--destructive)] border border-[var(--destructive)]/30 bg-[var(--destructive)]/5">
                      off track
                    </span>
                  )}
                </div>
                <p className="typo-caption text-foreground/60">
                  <span className="tabular-nums" style={{ color: accent }}>{group.goals.length}</span>
                  {' '}completed goal{group.goals.length === 1 ? '' : 's'} bidding to move this
                  {group.kpi ? '' : ' (no linked metric)'}
                </p>
              </div>
              {group.kpi && (
                <div className="text-right shrink-0">
                  <KpiMiniGauge kpi={group.kpi} width={180} />
                  <p className="typo-caption text-foreground/50 mt-1 tabular-nums">{pct}% to target</p>
                </div>
              )}
            </div>

            {/* Team columns inside the panel */}
            <div className="grid gap-3" style={cols}>
              {teams.map((team) => {
                const teamGoals = group.goals.filter((g) => g.teamId === team.id);
                return (
                  <div key={team.id} className="min-w-0 space-y-2">
                    <div className="flex items-center gap-1.5 pb-1.5 border-b" style={{ borderColor: wash(team.color, 25) }}>
                      <TeamMonogram team={team} size={18} />
                      <span className="typo-caption text-foreground/70 truncate">{team.name}</span>
                    </div>
                    {teamGoals.length === 0 ? (
                      <p className="typo-caption text-foreground/25 py-2 text-center">—</p>
                    ) : (
                      teamGoals.map((goal) => (
                        <GoalBidCard key={goal.id} goal={goal} accent={team.color}
                          onAccept={() => onAccept(goal.id)} onReject={(c) => onReject(goal.id, c)} />
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GoalBidCard({
  goal, accent, onAccept, onReject,
}: {
  goal: PendingGoal;
  accent: string;
  onAccept: () => void;
  onReject: (comment: string) => void;
}) {
  return (
    <div className="rounded-card border border-primary/10 bg-card/50 p-3" style={{ boxShadow: `inset 3px 0 0 0 ${accent}` }}>
      <h4 className="typo-card-label leading-snug break-words mb-1">{goal.title}</h4>
      <p className="typo-caption text-foreground/70 leading-snug line-clamp-3 mb-2">{goal.summary}</p>
      <div className="flex items-center gap-3 mb-2 typo-caption text-foreground/50">
        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{goal.completedAt}</span>
        <span className="inline-flex items-center gap-1 tabular-nums"><GitPullRequest className="w-3 h-3" />{goal.prs}</span>
      </div>
      <AcceptRejectControls size="sm" onAccept={onAccept} onReject={onReject} />
    </div>
  );
}
