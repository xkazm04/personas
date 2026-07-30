import { useEffect, useMemo, useState } from 'react';
import { History, Inbox, Link2, Pause, Play, Radio } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useSystemStore } from '@/stores/systemStore';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { setTeamAssignmentGoal } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import { AssignmentReplay } from '@/features/teams/sub_teamWorkspace/teamStudio/AssignmentReplay';
import { MissionLearning } from '@/features/teams/sub_assignments/MissionLearning';
import {
  GoalChip, PersonaStack, StepProgressStrip, StepRelay,
  isLiveAssignmentStatus, stepMeta, useAssignmentSteps, usePersonaIndex,
} from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';

/**
 * Rows in the first viewport that play the one-shot entrance cascade when a
 * fresh result set lands (35ms stagger via RevealItem, id-guarded so polling,
 * refresh, and per-row step ticking never replay it). Rows beyond this render
 * plainly. See docs/design/overview-loading.md.
 */
const CASCADE_ROWS = 14;

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
  // True while the per-team assignment fetch is in flight. It NEVER hides
  // rows already on screen — it only decides whether the mission rail shows
  // ghost rows (fetch running, nothing painted yet) or the settled empty
  // state (fetch finished, genuinely nothing). See docs/design/overview-loading.md.
  const [isFetching, setIsFetching] = useState(true);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  // Every team's missions — the board was single-team, which is not how you
  // watch a project. Stay `isFetching` until teams have loaded AND every
  // team's assignments have settled, so the rail doesn't flash empty first.
  useEffect(() => {
    if (teams.length === 0) return;
    let cancelled = false;
    setIsFetching(true);
    Promise.allSettled(teams.map((tm) => fetchTeamAssignments(tm.id))).finally(() => {
      if (!cancelled) setIsFetching(false);
    });
    return () => { cancelled = true; };
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
  const { steps, loaded: stepsLoaded, refresh: refreshSteps } = useAssignmentSteps(
    selected?.id ?? null,
    selected ? isLiveAssignmentStatus(selected.status) : false,
  );
  // The step relay resets to `[]`/`loaded=false` on every mission switch
  // (see boardShared.useAssignmentSteps), so a slow first fetch would flash
  // the "still decomposing" text for a mission that actually has steps. Ghost
  // it instead until that first fetch settles.
  const relayLoading = !!selected && !stepsLoaded;

  const grouped = useMemo(
    () =>
      PHASES.map((phase) => ({
        ...phase,
        items: assignments.filter((a) => phase.statuses.includes(a.status)),
      })).filter((g) => g.items.length > 0),
    [assignments],
  );

  const isTerminal = selected ? ['done', 'failed', 'aborted'].includes(selected.status) : false;

  // ── Loading choreography (docs/design/overview-loading.md, row-level) ──
  // Project-wide rail with no filter dimension, so the cascade replays only
  // on the first data landing (a fresh mount / cold store), never on the
  // per-row live polling inside MissionRow or on assignment refetches.
  const enter = useRevealTracker('missions');

  const link = (goalId: string) => {
    if (!selected || !goalId) return;
    setLinking(true);
    setTeamAssignmentGoal(selected.id, goalId)
      .then(() => fetchTeamAssignments(selected.teamId))
      .catch(silentCatch('missions:link-goal'))
      .finally(() => setLinking(false));
  };

  // Nothing painted yet + a fetch in flight: calm delayed ghost of the rail,
  // never the empty state (law 1 — a fetch never claims "nothing" for you).
  if (isFetching && assignments.length === 0) {
    return <GoalsMissionsGhost />;
  }

  if (assignments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <Inbox className="w-8 h-8 text-foreground" />
        <p className="typo-body text-foreground">{ts.deck_empty}</p>
      </div>
    );
  }

  let cascadeOrder = -1;

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
              {g.items.map((a) => {
                cascadeOrder += 1;
                const order = cascadeOrder;
                return (
                  <RevealItem
                    key={a.id}
                    revealId={a.id}
                    order={order}
                    hasEntered={(id) => order >= CASCADE_ROWS || enter.hasEntered(id)}
                    markEntered={enter.markEntered}
                  >
                    <MissionRow
                      assignment={a}
                      team={teamName.get(a.teamId) ?? ''}
                      selected={a.id === selectedId}
                      onClick={() => setSelectedId(a.id)}
                    />
                  </RevealItem>
                );
              })}
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

            {relayLoading ? (
              <StepRelayGhost />
            ) : steps.length > 0 && replaying ? (
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

            {/* Self-Evolving Team: the learning record for a finished mission —
                outcome evidence, trust deltas, retro status, team lessons. */}
            {isTerminal && <MissionLearning assignmentId={selected.id} teamId={selected.teamId} />}
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

// ---------------------------------------------------------------------------
// Ghosts — calm, delayed, geometry-matched (docs/design/overview-loading.md).
// Each bar enters via `animate-fade-in` (150ms, fill-mode: both) behind a
// staggered animation-delay starting at 120ms, so a fast fetch never paints
// one. No `animate-pulse`. `aria-hidden` — these are silhouettes, not content.
// ---------------------------------------------------------------------------

const GHOST_BAR = 'rounded bg-primary/[0.06]';
/** Deterministic width variation so ghost rows read as missions, not a barcode. */
const GHOST_TITLE_WIDTHS = ['w-40', 'w-28', 'w-44', 'w-32'];

/** Whole-page ghost: nothing painted yet, per-team fetch still in flight. */
function GoalsMissionsGhost() {
  return (
    <div className="flex gap-4 min-h-0 h-[calc(100vh-240px)]" aria-hidden="true" data-testid="goals-missions-ghost">
      <div className="w-72 flex-shrink-0 min-h-0 overflow-hidden pr-1 space-y-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <MissionGhostRow key={i} index={i} />
        ))}
      </div>
      <div className="flex-1 min-w-0 min-h-0 rounded-card border border-primary/10 bg-secondary/10 px-5 py-4">
        <StepRelayGhost />
      </div>
    </div>
  );
}

/** One ghost mission row — mirrors MissionRow: title bar, team label, persona-stack dots, progress strip. */
function MissionGhostRow({ index }: { index: number }) {
  const titleW = GHOST_TITLE_WIDTHS[index % GHOST_TITLE_WIDTHS.length];
  return (
    <div
      className="rounded-card border border-primary/10 bg-background/40 px-3 py-2.5 animate-fade-in"
      style={{ animationDelay: `${120 + index * 35}ms` }}
    >
      <span className={`block h-3.5 ${titleW} max-w-full ${GHOST_BAR}`} />
      <div className="mt-1 flex items-center gap-1.5">
        <span className={`h-2.5 w-16 ${GHOST_BAR}`} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center -space-x-1">
          {Array.from({ length: 3 }).map((_, d) => (
            <span key={d} className="w-2.5 h-2.5 rounded-full bg-primary/[0.08] ring-2 ring-background" />
          ))}
        </div>
        <span className={`h-2.5 w-10 ${GHOST_BAR}`} />
      </div>
    </div>
  );
}

/**
 * Ghost of the step relay — used both inside the whole-page ghost and,
 * surgically, when a mission is selected but its first step fetch hasn't
 * settled yet (`relayLoading`), so the pane never flashes "still
 * decomposing" for a mission that actually has steps.
 */
function StepRelayGhost() {
  return (
    <div className="flex flex-col" aria-hidden="true" data-testid="step-relay-ghost">
      <span className="block h-4 w-48 max-w-full rounded bg-primary/[0.06] mb-4 animate-fade-in" style={{ animationDelay: '120ms' }} />
      {Array.from({ length: 3 }).map((_, i) => {
        const isLast = i === 2;
        return (
          <div key={i} className="relative flex gap-3 animate-fade-in" style={{ animationDelay: `${140 + i * 35}ms` }}>
            <div className="flex flex-col items-center w-7 flex-shrink-0">
              <span className="flex items-center justify-center w-7 h-7 rounded-full border border-primary/15 bg-secondary/30" />
              {!isLast && <span className="w-px flex-1 min-h-3 bg-primary/15" />}
            </div>
            <div className={`flex-1 min-w-0 pb-3 ${isLast ? 'pb-0' : ''}`}>
              <span className="block h-3.5 w-36 max-w-full rounded bg-primary/[0.06]" />
              <span className="block h-2.5 w-24 max-w-full rounded bg-primary/[0.06] mt-2" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default GoalsMissions;
