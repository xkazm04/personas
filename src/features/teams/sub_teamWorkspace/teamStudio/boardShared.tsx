import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleDashed, Loader2, AlertCircle, CheckCircle2, CircleSlash, XCircle, Wand2,
  ChevronDown, ChevronRight, SkipForward, Ban, RotateCcw, Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { listTeamAssignmentSteps, resolveTeamAssignmentReview } from '@/api/pipeline/assignments';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';

/* ----------------------------------------------------------------------------
 * Shared primitives for the assignment-board prototypes.
 * Extraction-ready: step status meta, progress strip, persona chips and the
 * StepRelay (vertical step pipeline with live statuses, rework rounds and
 * review intervention) are deliberately standalone so the winning variant —
 * and other surfaces (goal drawer, incidents) — can import them.
 * -------------------------------------------------------------------------- */

export interface StepStatusMeta {
  icon: LucideIcon;
  /** Tailwind text class for the icon / accents. */
  tone: string;
  /** Soft background tint for chips/rows. */
  tint: string;
  label: string;
  spin?: boolean;
}

/** Canonical visual vocabulary for the 7 orchestrator step statuses. */
export const STEP_STATUS_META: Record<string, StepStatusMeta> = {
  pending: { icon: CircleDashed, tone: 'text-foreground/40', tint: 'bg-secondary/30', label: 'Pending' },
  matching: { icon: Wand2, tone: 'text-violet-400', tint: 'bg-violet-500/10', label: 'Matching' },
  running: { icon: Loader2, tone: 'text-blue-400', tint: 'bg-blue-500/10', label: 'Running', spin: true },
  awaiting_review: { icon: AlertCircle, tone: 'text-amber-400', tint: 'bg-amber-500/10', label: 'Needs review' },
  done: { icon: CheckCircle2, tone: 'text-emerald-400', tint: 'bg-emerald-500/10', label: 'Done' },
  skipped: { icon: CircleSlash, tone: 'text-foreground/35', tint: 'bg-secondary/20', label: 'Skipped' },
  failed: { icon: XCircle, tone: 'text-red-400', tint: 'bg-red-500/10', label: 'Failed' },
};

const PENDING_META: StepStatusMeta = { icon: CircleDashed, tone: 'text-foreground/40', tint: 'bg-secondary/30', label: 'Pending' };

export function stepMeta(status: string): StepStatusMeta {
  return STEP_STATUS_META[status] ?? PENDING_META;
}

/** Dot color (bg-*) for the compact progress strip. */
const STRIP_DOT: Record<string, string> = {
  pending: 'bg-foreground/15',
  matching: 'bg-violet-400',
  running: 'bg-blue-400',
  awaiting_review: 'bg-amber-400',
  done: 'bg-emerald-400',
  skipped: 'bg-foreground/25',
  failed: 'bg-red-400',
};

/** Compact per-step dot strip — one dot per step, in step order. */
export function StepProgressStrip({ steps, className }: { steps: TeamAssignmentStep[]; className?: string }) {
  if (steps.length === 0) return null;
  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`} aria-hidden>
      {steps.map((s) => (
        <span
          key={s.id}
          title={`${s.title} — ${stepMeta(s.status).label}`}
          className={`h-1.5 rounded-full transition-colors ${STRIP_DOT[s.status] ?? STRIP_DOT.pending} ${
            s.status === 'running' ? 'w-3.5' : 'w-1.5'
          }`}
        />
      ))}
    </div>
  );
}

/** Map persona ids to personas once per render tree. */
export function usePersonaIndex(): Map<string, Persona> {
  const personas = useAgentStore((s) => s.personas) as Persona[];
  return useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
}

/** Small persona chip: icon + short name. */
export function PersonaChip({ persona, dim }: { persona: Persona | undefined; dim?: boolean }) {
  if (!persona) return null;
  const short = persona.name.replace(/^T: /, '');
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/10 max-w-[160px] ${
        dim ? 'opacity-60' : ''
      }`}
      title={short}
    >
      <PersonaIcon icon={persona.icon} color={persona.color} size="w-3 h-3" />
      <span className="typo-caption text-foreground/80 truncate">{short}</span>
    </span>
  );
}

/** Overlapping stack of unique persona icons (e.g. on a kanban card). */
export function PersonaStack({ ids, index, max = 4 }: { ids: Array<string | null>; index: Map<string, Persona>; max?: number }) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return null;
  const shown = unique.slice(0, max);
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((id) => {
        const p = index.get(id);
        if (!p) return null;
        return (
          <span
            key={id}
            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-secondary/80 ring-2 ring-background"
            title={p.name.replace(/^T: /, '')}
          >
            <PersonaIcon icon={p.icon} color={p.color} size="w-3 h-3" />
          </span>
        );
      })}
      {unique.length > max && (
        <span className="pl-2 typo-caption text-foreground/50">+{unique.length - max}</span>
      )}
    </div>
  );
}

/**
 * Steps for one assignment, kept fresh: fetch on mount/id change, refetch on a
 * gentle interval while the assignment is in a live status. The global
 * assignment progress listener keeps the assignment rows fresh; this fills the
 * step-level gap for the focused assignment.
 */
export function useAssignmentSteps(assignmentId: string | null, live: boolean) {
  const [steps, setSteps] = useState<TeamAssignmentStep[]>([]);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    if (!assignmentId) return;
    listTeamAssignmentSteps(assignmentId)
      .then((s) => {
        setSteps([...s].sort((a, b) => a.stepOrder - b.stepOrder));
        setLoaded(true);
      })
      .catch(silentCatch('teams/boardShared:useAssignmentSteps'));
  }, [assignmentId]);

  useEffect(() => {
    setSteps([]);
    setLoaded(false);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (live && assignmentId) {
      timer.current = setInterval(refresh, 5000);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [live, assignmentId, refresh]);

  return { steps, loaded, refresh };
}

/* ----------------------------------------------------------------------------
 * StepRelay — the vertical step pipeline for one assignment.
 * Each step: order badge + connector, persona chip, status, rework-round badge
 * (retryCount > 0 — the QA fix-loop signal), expandable output (markdown), and
 * inline skip/abort intervention for awaiting_review steps.
 * -------------------------------------------------------------------------- */

export function StepRelay({
  steps,
  personaIndex,
  onIntervened,
}: {
  steps: TeamAssignmentStep[];
  personaIndex: Map<string, Persona>;
  onIntervened?: () => void;
}) {
  const { t, tx } = useTranslation();
  const ts = t.pipeline.team_studio;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const intervene = async (stepId: string, action: 'skip' | 'abort') => {
    setBusy(stepId);
    try {
      await resolveTeamAssignmentReview(stepId, { action });
      onIntervened?.();
    } catch (err) {
      silentCatch('teams/boardShared:StepRelay:intervene')(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ol className="flex flex-col" data-testid="step-relay">
      {steps.map((s, i) => {
        const meta = stepMeta(s.status);
        const Icon = meta.icon;
        const persona = s.assignedPersonaId ? personaIndex.get(s.assignedPersonaId) : undefined;
        const output = s.outputSummary?.trim();
        const isOpen = expanded === s.id;
        const isLast = i === steps.length - 1;
        return (
          <li key={s.id} className="relative flex gap-3">
            {/* Rail: order badge + connector line */}
            <div className="flex flex-col items-center w-7 flex-shrink-0">
              <span
                className={`flex items-center justify-center w-7 h-7 rounded-full border ${meta.tint} ${
                  s.status === 'running' ? 'border-blue-400/50' : 'border-primary/15'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${meta.tone} ${meta.spin ? 'animate-spin' : ''}`} />
              </span>
              {!isLast && <span className="w-px flex-1 min-h-3 bg-primary/15" />}
            </div>

            {/* Body */}
            <div className={`flex-1 min-w-0 pb-3 ${isLast ? 'pb-0' : ''}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`typo-body font-medium ${
                        s.status === 'skipped' ? 'text-foreground/45 line-through' : 'text-foreground'
                      }`}
                    >
                      {s.title}
                    </span>
                    {s.retryCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-amber-500/10 border border-amber-500/25 typo-caption text-amber-300"
                        title={tx(ts.deck_rework_tooltip, { round: s.retryCount })}
                      >
                        <RotateCcw className="w-3 h-3" />
                        {tx(ts.deck_round, { round: s.retryCount + 1 })}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <PersonaChip persona={persona} dim={s.status === 'skipped'} />
                    <span className={`typo-caption ${meta.tone}`}>{meta.label}</span>
                    {s.errorMessage && s.status === 'failed' && (
                      <span className="typo-caption text-red-300/80 truncate max-w-[280px]" title={s.errorMessage}>
                        {s.errorMessage}
                      </span>
                    )}
                  </div>
                </div>

                {/* Review intervention */}
                {s.status === 'awaiting_review' && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      disabled={busy === s.id}
                      onClick={() => void intervene(s.id, 'skip')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/15 bg-secondary/40 typo-caption text-foreground/80 hover:bg-secondary/60 transition-colors disabled:opacity-50"
                    >
                      <SkipForward className="w-3 h-3" /> {ts.deck_skip}
                    </button>
                    <button
                      type="button"
                      disabled={busy === s.id}
                      onClick={() => void intervene(s.id, 'abort')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-red-500/25 bg-red-500/10 typo-caption text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    >
                      <Ban className="w-3 h-3" /> {ts.deck_abort}
                    </button>
                  </div>
                )}
              </div>

              {/* Expandable output */}
              {output && (
                <div className="mt-1.5">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="inline-flex items-center gap-1 typo-caption text-foreground/55 hover:text-foreground/85 transition-colors"
                  >
                    {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    {ts.deck_output}
                  </button>
                  {isOpen && (
                    <div className="mt-1.5 rounded-card border border-primary/10 bg-background/50 px-3 py-2 max-h-72 overflow-y-auto">
                      <MarkdownRenderer content={output} className="typo-caption leading-relaxed" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Goal chip — marks a goal-linked assignment and deep-links to the Goals hub. */
export function GoalChip({ goalId }: { goalId: string | null }) {
  const { t } = useTranslation();
  const setTeamsTab = (tab: 'workspace' | 'goals') =>
    import('@/stores/systemStore').then((m) => m.useSystemStore.getState().setTeamsTab(tab));
  if (!goalId) return null;
  return (
    <button
      type="button"
      onClick={() => void setTeamsTab('goals')}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-violet-500/10 border border-violet-500/25 typo-caption text-violet-300 hover:bg-violet-500/20 transition-colors"
      title={t.pipeline.team_studio.deck_goal_chip_tooltip}
    >
      <Target className="w-3 h-3" />
      {t.pipeline.team_studio.deck_goal_chip}
    </button>
  );
}

/** Assignment-level live check (drives polling + pulses). */
export function isLiveAssignmentStatus(status: string): boolean {
  return status === 'running' || status === 'queued' || status === 'awaiting_review';
}

/** Convenience: refetch a team's assignments (store action passthrough). */
export function useRefreshAssignments(teamId: string) {
  const fetchList = usePipelineStore((s) => s.fetchTeamAssignments);
  return useCallback(() => void fetchList(teamId), [fetchList, teamId]);
}
