import { useEffect, useMemo, useState } from 'react';
import { Radio, Inbox } from 'lucide-react';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';
import {
  StepProgressStrip, StepRelay, GoalChip, PersonaStack,
  usePersonaIndex, useAssignmentSteps, isLiveAssignmentStatus, useRefreshAssignments, stepMeta,
} from './boardShared';

/**
 * FLIGHT DECK variant — "mission control".
 *
 * Metaphor: an operations console. The left rail lists every assignment as a
 * mission row grouped by phase (Active → Needs review → Queued → Landed →
 * Stopped), each carrying a live step-progress strip. The main pane is the
 * selected mission's STEP RELAY — the full pipeline with per-step personas,
 * statuses, QA rework rounds, expandable outputs and inline review
 * intervention. One mission in deep focus at all times; the rail keeps the
 * fleet peripheral. Differs from baseline (kanban of bare cards, no step
 * visibility) by inverting the hierarchy: steps are the primary object.
 */

const PHASES: Array<{ id: string; labelKey: 'deck_phase_active' | 'deck_phase_review' | 'deck_phase_queued' | 'deck_phase_landed' | 'deck_phase_stopped'; statuses: string[]; tone: string }> = [
  { id: 'active', labelKey: 'deck_phase_active', statuses: ['running'], tone: 'text-blue-400' },
  { id: 'review', labelKey: 'deck_phase_review', statuses: ['awaiting_review'], tone: 'text-amber-400' },
  { id: 'queued', labelKey: 'deck_phase_queued', statuses: ['queued'], tone: 'text-foreground/60' },
  { id: 'landed', labelKey: 'deck_phase_landed', statuses: ['done'], tone: 'text-emerald-400' },
  { id: 'stopped', labelKey: 'deck_phase_stopped', statuses: ['failed', 'aborted'], tone: 'text-red-400' },
];

function toIsoUtc(s: string): string {
  if (!s) return s;
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s.replace(' ', 'T')}Z`;
}

export function TeamAssignmentBoardFlightDeck({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const assignments = usePipelineStore((s) => s.assignmentsByTeam[teamId]) ?? [];
  const refreshAssignments = useRefreshAssignments(teamId);
  const personaIndex = usePersonaIndex();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    refreshAssignments();
  }, [refreshAssignments]);

  // Default-select the most interesting mission: running > review > newest.
  useEffect(() => {
    if (selectedId && assignments.some((a) => a.id === selectedId)) return;
    const pick =
      assignments.find((a) => a.status === 'running') ??
      assignments.find((a) => a.status === 'awaiting_review') ??
      assignments[0] ??
      null;
    setSelectedId(pick?.id ?? null);
  }, [assignments, selectedId]);

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

  if (assignments.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
        <Inbox className="w-8 h-8 text-foreground/30" />
        <p className="typo-body text-foreground/50">{ts.deck_empty}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex gap-4 min-h-0" data-testid="board-flight-deck">
      {/* Mission rail */}
      <div className="w-72 flex-shrink-0 min-h-0 overflow-y-auto pr-1 space-y-4">
        {grouped.map((g) => (
          <div key={g.id}>
            <p className={`px-1 mb-1.5 typo-label uppercase tracking-wider ${g.tone}`}>
              {ts[g.labelKey]} <span className="text-foreground/40 font-mono">{g.items.length}</span>
            </p>
            <div className="space-y-1.5">
              {g.items.map((a) => (
                <MissionRow
                  key={a.id}
                  assignment={a}
                  selected={a.id === selectedId}
                  onClick={() => setSelectedId(a.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Focused mission — the step relay */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-secondary/10 px-5 py-4">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="typo-section-title text-foreground">{selected.title.replace(/^Advance: /, '')}</h3>
              <div className="flex items-center gap-2 flex-shrink-0">
                <GoalChip goalId={selected.goalId} />
                {selected.status === 'running' && (
                  <span className="inline-flex items-center gap-1.5 typo-caption text-blue-300">
                    <Radio className="w-3.5 h-3.5" /> {ts.deck_live}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <span className={`typo-caption ${stepMeta(selected.status === 'awaiting_review' ? 'awaiting_review' : selected.status === 'running' ? 'running' : 'pending').tone}`}>
                {selected.status.replace('_', ' ')}
              </span>
              <span className="typo-caption text-foreground/45">
                <RelativeTime timestamp={toIsoUtc(selected.createdAt)} />
              </span>
              <PersonaStack ids={steps.map((s) => s.assignedPersonaId)} index={personaIndex} />
            </div>
            {steps.length > 0 ? (
              <StepRelay
                steps={steps}
                personaIndex={personaIndex}
                onIntervened={() => {
                  refreshSteps();
                  refreshAssignments();
                }}
              />
            ) : (
              <p className="typo-body text-foreground/45">{ts.deck_decomposing}</p>
            )}
          </>
        ) : (
          <p className="typo-body text-foreground/45">{ts.deck_select}</p>
        )}
      </div>
    </div>
  );
}

function MissionRow({
  assignment,
  selected,
  onClick,
}: {
  assignment: TeamAssignment;
  selected: boolean;
  onClick: () => void;
}) {
  // The rail rows fetch their steps lazily for the progress strip; live rows
  // poll so the strip tracks the orchestrator in near-real-time.
  const { steps } = useAssignmentSteps(assignment.id, isLiveAssignmentStatus(assignment.status));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={`w-full text-left rounded-card border px-3 py-2.5 transition-colors ${
        selected
          ? 'border-primary/40 bg-secondary/40'
          : 'border-primary/10 bg-background/40 hover:bg-secondary/25'
      }`}
      data-testid="mission-row"
    >
      <h4 className="typo-card-label text-foreground line-clamp-2">
        {assignment.title.replace(/^Advance: /, '')}
      </h4>
      <div className="mt-2 flex items-center justify-between gap-2">
        <StepProgressStrip steps={steps} />
        <span className="typo-caption text-foreground/40 flex-shrink-0">
          <RelativeTime timestamp={toIsoUtc(assignment.createdAt)} />
        </span>
      </div>
    </button>
  );
}

export default TeamAssignmentBoardFlightDeck;
