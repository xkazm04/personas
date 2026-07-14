import { useEffect, useMemo, useState } from 'react';
import { History, Inbox, Link2, Pause, Play, Radio } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useSystemStore } from '@/stores/systemStore';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { setTeamAssignmentGoal } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import { AssignmentReplay } from '@/features/teams/sub_teamWorkspace/teamStudio/AssignmentReplay';
import {
  GoalChip, PersonaStack, StepProgressStrip, StepRelay,
  isLiveAssignmentStatus, stepMeta, useAssignmentSteps, usePersonaIndex,
} from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';

/* ----------------------------------------------------------------------------
 * MISSIONS — the Assignment Board, folded into Goals (plan D3).
 *
 * The Teams "flight deck" was the only place an assignment's step relay, rework
 * rounds, pause/resume and replay existed. Goals could show an assignment only
 * through a goal it was linked to — and the Assign flow creates assignments with
 * `goalId: null`. So deleting the board without this view would have made every
 * ad-hoc mission INVISIBLE. That was the one genuinely lossy migration in the
 * whole consolidation, and this is the fix.
 *
 * Two differences from the board it replaces:
 *   • it is PROJECT-scoped, not team-scoped — missions from every team in the
 *     project land in one rail, which is how you actually watch a project; and
 *   • goal-less missions are first-class, and can be LINKED to a goal from here
 *     (`set_team_assignment_goal` already existed; nothing could reach it).
 * -------------------------------------------------------------------------- */

const PHASES: Array<{
  id: string;
  labelKey: 'deck_phase_active' | 'deck_phase_review' | 'deck_phase_paused' | 'deck_phase_queued' | 'deck_phase_landed' | 'deck_phase_stopped';
  statuses: string[];
  tone: string;
}> = [
  { id: 'active', labelKey: 'deck_phase_active', statuses: ['running'], tone: 'text-blue-400' },
  { id: 'review', labelKey: 'deck_phase_review', statuses: ['awaiting_review'], tone: 'text-amber-400' },
  { id: 'paused', labelKey: 'deck_phase_paused', statuses: ['paused'], tone: 'text-amber-300' },
  { id: 'queued', labelKey: 'deck_phase_queued', statuses: ['queued'], tone: 'text-foreground' },
  { id: 'landed', labelKey: 'deck_phase_landed', statuses: ['done'], tone: 'text-emerald-400' },
  { id: 'stopped', labelKey: 'deck_phase_stopped', statuses: ['failed', 'aborted'], tone: 'text-red-400' },
];

function toIsoUtc(s: string): string {
  if (!s) return s;
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s.replace(' ', 'T')}Z`;
}

export function GoalsMissions() {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const dl = t.plugins.dev_lifecycle;

  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const assignmentsByTeam = usePipelineStore((s) => s.assignmentsByTeam);
  const fetchTeamAssignments = usePipelineStore((s) => s.fetchTeamAssignments);
  const pauseAssignment = usePipelineStore((s) => s.pauseAssignment);
  const resumeAssignment = usePipelineStore((s) => s.resumeAssignment);
  const goals = useSystemStore((s) => s.goals);
  const personaIndex = usePersonaIndex();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  // Every team's missions — the board was single-team, which is not how you
  // watch a project.
  useEffect(() => {
    for (const tm of teams) void fetchTeamAssignments(tm.id);
  }, [teams, fetchTeamAssignments]);

  const teamName = useMemo(() => {
    const m = new Map<string, string>();
    for (const tm of teams) m.set(tm.id, tm.name.replace(/^SDLC[ —-]*/i, '') || tm.name);
    return m;
  }, [teams]);

  const assignments = useMemo(() => {
    const all: TeamAssignment[] = [];
    for (const tm of teams) all.push(...(assignmentsByTeam[tm.id] ?? []));
    return all.sort((a, b) => toIsoUtc(b.createdAt).localeCompare(toIsoUtc(a.createdAt)));
  }, [teams, assignmentsByTeam]);

  useEffect(() => {
    if (selectedId && assignments.some((a) => a.id === selectedId)) return;
    const pick =
      assignments.find((a) => a.status === 'running') ??
      assignments.find((a) => a.status === 'awaiting_review') ??
      assignments[0] ??
      null;
    setSelectedId(pick?.id ?? null);
  }, [assignments, selectedId]);

  useEffect(() => setReplaying(false), [selectedId]);

  const selected = assignments.find((a) => a.id === selectedId) ?? null;
  const { steps, refresh: refreshSteps } = useAssignmentSteps(
    selected?.id ?? null,
    selected ? isLiveAssignmentStatus(selected.status) : false,
  );

  const grouped = useMemo(
    () =>
      PHASES.map((phase) => ({
        ...phase,
        items: assignments.filter((a) => phase.statuses.includes(a.status)),
      })).filter((g) => g.items.length > 0),
    [assignments],
  );

  const isTerminal = selected ? ['done', 'failed', 'aborted'].includes(selected.status) : false;

  const link = (goalId: string) => {
    if (!selected || !goalId) return;
    setLinking(true);
    setTeamAssignmentGoal(selected.id, goalId)
      .then(() => fetchTeamAssignments(selected.teamId))
      .catch(silentCatch('missions:link-goal'))
      .finally(() => setLinking(false));
  };

  if (assignments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <Inbox className="w-8 h-8 text-foreground" />
        <p className="typo-body text-foreground">{ts.deck_empty}</p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 min-h-0 h-[calc(100vh-240px)]" data-testid="goals-missions">
      {/* Mission rail — every phase, every team. */}
      <div className="w-72 flex-shrink-0 min-h-0 overflow-y-auto pr-1 space-y-4">
        {grouped.map((g) => (
          <div key={g.id}>
            <p className={`px-1 mb-1.5 typo-label uppercase tracking-wider ${g.tone}`}>
              {ts[g.labelKey]} <span className="text-foreground font-mono">{g.items.length}</span>
            </p>
            <div className="space-y-1.5">
              {g.items.map((a) => (
                <MissionRow
                  key={a.id}
                  assignment={a}
                  team={teamName.get(a.teamId) ?? ''}
                  selected={a.id === selectedId}
                  onClick={() => setSelectedId(a.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The focused mission — its step relay. */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-secondary/10 px-5 py-4">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="typo-section-title text-foreground">{selected.title.replace(/^Advance: /, '')}</h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                {selected.goalId ? (
                  <GoalChip goalId={selected.goalId} />
                ) : (
                  /* THE POINT OF THIS VIEW. An ad-hoc mission has no goal, so the
                     old Goals hub could not show it at all. Here it is, and it can
                     be adopted into a goal. */
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-primary/15 bg-secondary/30 typo-caption text-foreground">
                      <Link2 className="w-3 h-3" /> {dl.mission_unlinked}
                    </span>
                    {goals.length > 0 && (
                      <ThemedSelect
                        filterable
                        hideSearch={goals.length < 8}
                        value=""
                        onValueChange={link}
                        disabled={linking}
                        placeholder={dl.mission_link_goal}
                        options={goals.map((g) => ({ value: g.id, label: g.title }))}
                        wrapperClassName="w-44"
                      />
                    )}
                  </span>
                )}
                {selected.status === 'running' && (
                  <span className="inline-flex items-center gap-1.5 typo-caption text-blue-300">
                    <Radio className="w-3.5 h-3.5" /> {ts.deck_live}
                  </span>
                )}
                {(selected.status === 'running' || selected.status === 'queued') && (
                  <button
                    type="button"
                    onClick={() => void pauseAssignment(selected.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-amber-500/30 bg-amber-500/10 typo-caption text-amber-300 hover:bg-amber-500/20 transition-colors"
                  >
                    <Pause className="w-3 h-3" /> {ts.deck_pause}
                  </button>
                )}
                {selected.status === 'paused' && (
                  <button
                    type="button"
                    onClick={() => void resumeAssignment(selected.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-blue-500/30 bg-blue-500/10 typo-caption text-blue-300 hover:bg-blue-500/20 transition-colors"
                  >
                    <Play className="w-3 h-3" /> {ts.deck_resume}
                  </button>
                )}
                {isTerminal && steps.length > 0 && !replaying && (
                  <button
                    type="button"
                    onClick={() => setReplaying(true)}
                    data-testid="missions-replay"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-violet-500/30 bg-violet-500/10 typo-caption text-violet-300 hover:bg-violet-500/20 transition-colors"
                  >
                    <History className="w-3 h-3" /> {ts.deck_replay}
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4">
              <span
                className={`typo-caption ${
                  stepMeta(
                    selected.status === 'awaiting_review'
                      ? 'awaiting_review'
                      : selected.status === 'running'
                        ? 'running'
                        : 'pending',
                  ).tone
                }`}
              >
                {selected.status.replace('_', ' ')}
              </span>
              <span className="typo-caption text-foreground">{teamName.get(selected.teamId)}</span>
              <span className="typo-caption text-foreground">
                <RelativeTime timestamp={toIsoUtc(selected.createdAt)} />
              </span>
              <PersonaStack ids={steps.map((s) => s.assignedPersonaId)} index={personaIndex} />
            </div>

            {steps.length > 0 && replaying ? (
              <AssignmentReplay steps={steps} personaIndex={personaIndex} onExit={() => setReplaying(false)} />
            ) : steps.length > 0 ? (
              <StepRelay
                steps={steps}
                personaIndex={personaIndex}
                onIntervened={() => {
                  refreshSteps();
                  void fetchTeamAssignments(selected.teamId);
                }}
              />
            ) : (
              <p className="typo-body text-foreground">{ts.deck_decomposing}</p>
            )}
          </>
        ) : (
          <p className="typo-body text-foreground">{ts.deck_select}</p>
        )}
      </div>
    </div>
  );
}

function MissionRow({
  assignment, team, selected, onClick,
}: {
  assignment: TeamAssignment;
  team: string;
  selected: boolean;
  onClick: () => void;
}) {
  // Live rows poll so the strip tracks the orchestrator in near-real-time.
  const { steps } = useAssignmentSteps(assignment.id, isLiveAssignmentStatus(assignment.status));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={`w-full text-left rounded-card border px-3 py-2.5 transition-colors ${
        selected ? 'border-primary/40 bg-secondary/40' : 'border-primary/10 bg-background/40 hover:bg-secondary/25'
      }`}
      data-testid="mission-row"
    >
      <h4 className="typo-card-label text-foreground line-clamp-2">
        {assignment.title.replace(/^Advance: /, '')}
      </h4>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="typo-caption text-foreground opacity-55 truncate">{team}</span>
        {!assignment.goalId && <Link2 className="w-3 h-3 flex-shrink-0 text-foreground opacity-35" />}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <StepProgressStrip steps={steps} />
        <span className="typo-caption text-foreground flex-shrink-0">
          <RelativeTime timestamp={toIsoUtc(assignment.createdAt)} />
        </span>
      </div>
    </button>
  );
}

export default GoalsMissions;
