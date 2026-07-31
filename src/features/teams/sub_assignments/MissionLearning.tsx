import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  getAssignmentOutcome,
  listTeamLessons,
  parseOutcomeSteps,
  type OutcomeStepEvidence,
} from '@/api/pipeline/teamLearning';
import { silentCatch } from '@/lib/silentCatch';
import { PersonaChip, usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import type { AssignmentOutcome } from '@/lib/bindings/AssignmentOutcome';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';

const LESSONS_SHOWN = 3;

/**
 * Self-Evolving Team v1 — the evidence drawer for a terminal mission.
 *
 * Renders the assignment's learning record: the outcome summary, the per-step
 * Brier trust deltas (what each step DID to each persona's team trust), the
 * retrospective status (held / honestly skipped, with the reason), and the
 * team's distilled lessons. Missions that finished before the learning loop
 * shipped show an honest empty state — no invented history.
 */
export function MissionLearning({ assignmentId, teamId }: {
  assignmentId: string;
  teamId: string;
}) {
  const { t, tx } = useTranslation();
  const ts = t.pipeline.team_studio;
  const personaIndex = usePersonaIndex();

  const [outcome, setOutcome] = useState<AssignmentOutcome | null>(null);
  const [lessons, setLessons] = useState<TeamMemory[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setOutcome(null);
    Promise.all([
      getAssignmentOutcome(assignmentId),
      listTeamLessons(teamId, LESSONS_SHOWN),
    ])
      .then(([o, l]) => {
        if (cancelled) return;
        setOutcome(o);
        setLessons(l);
      })
      .catch(silentCatch('missions:learning'))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [assignmentId, teamId]);

  if (!loaded) return null;

  const steps = outcome ? parseOutcomeSteps(outcome.outcomeJson) : [];
  const trustSteps = steps.filter(
    (s) => s.trustBefore !== undefined && s.trustAfter !== undefined && s.personaId,
  );

  return (
    <div className="mt-4 rounded-card border border-primary/10 bg-secondary/10 px-4 py-3 space-y-3" data-testid="mission-learning">
      <div className="flex items-center gap-2">
        <GraduationCap className="w-3.5 h-3.5 text-violet-300/80" />
        <h4 className="typo-label uppercase tracking-wider text-foreground">{ts.learning_heading}</h4>
      </div>

      {!outcome ? (
        <p className="typo-caption text-foreground italic">{ts.learning_empty}</p>
      ) : (
        <>
          {/* Outcome summary — the recorded evidence, not a recomputation. */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="typo-caption text-foreground tabular-nums">
              {tx(ts.learning_steps_summary, {
                done: outcome.stepsDone,
                failed: outcome.stepsFailed,
                skipped: outcome.stepsSkipped,
              })}
            </span>
            {outcome.reviewInterventions > 0 && (
              <span className="typo-caption text-amber-300 tabular-nums">
                {tx(ts.learning_interventions, { count: outcome.reviewInterventions })}
              </span>
            )}
            <span className="typo-caption text-foreground">{retroLabel(ts, outcome)}</span>
          </div>

          {/* Per-step trust deltas — what this mission taught the matcher. */}
          {trustSteps.length > 0 && (
            <div className="space-y-1.5">
              <p className="typo-label uppercase tracking-wider text-foreground">{ts.learning_trust_heading}</p>
              {trustSteps.map((s) => (
                <TrustDeltaRow key={s.stepId} step={s} personaIndex={personaIndex} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Team lessons — retrieved from the same ledger the matcher reads. */}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 typo-label uppercase tracking-wider text-foreground">
          <BookOpen className="w-3 h-3" /> {ts.learning_lessons_heading}
        </p>
        {lessons.length === 0 ? (
          <p className="typo-caption text-foreground italic">{ts.learning_no_lessons}</p>
        ) : (
          lessons.map((l) => (
            <p key={l.id} className="typo-caption text-foreground/85 line-clamp-2">
              <span className="font-medium text-foreground">{l.title.replace(/^Lesson: /, '')}</span>
              {' — '}
              {lessonGist(l.content)}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function TrustDeltaRow({ step, personaIndex }: {
  step: OutcomeStepEvidence;
  personaIndex: ReturnType<typeof usePersonaIndex>;
}) {
  const persona = step.personaId ? personaIndex.get(step.personaId) : undefined;
  const before = step.trustBefore ?? 0;
  const after = step.trustAfter ?? 0;
  const up = after >= before;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <PersonaChip persona={persona} />
      <span className="typo-caption text-foreground truncate max-w-52">{step.title}</span>
      <span className={`inline-flex items-center gap-1 typo-caption tabular-nums ${up ? 'text-emerald-300' : 'text-amber-300'}`}>
        {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {before.toFixed(2)}
        <ArrowRight className="w-2.5 h-2.5" />
        {after.toFixed(2)}
      </span>
    </div>
  );
}

/** Strip the provenance preamble; show the lesson itself. */
function lessonGist(content: string): string {
  const idx = content.indexOf('Lesson: ');
  return idx >= 0 ? content.slice(idx + 'Lesson: '.length) : content;
}

function retroLabel(
  ts: { learning_retro_held: string; learning_retro_skipped_trivial: string; learning_retro_skipped_aborted: string; learning_retro_skipped_busy: string; learning_retro_none: string },
  outcome: AssignmentOutcome,
): string {
  if (outcome.retroDeliberationId) return ts.learning_retro_held;
  switch (outcome.retroSkippedReason) {
    case 'trivial_run':
      return ts.learning_retro_skipped_trivial;
    case 'aborted':
      return ts.learning_retro_skipped_aborted;
    case 'active_deliberation':
      return ts.learning_retro_skipped_busy;
    default:
      return ts.learning_retro_none;
  }
}

export default MissionLearning;
