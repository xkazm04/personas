import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Sparkles, ArrowRight, Check, CircleDot, Plus } from 'lucide-react';
import { decomposeTeamAssignmentGoal } from '@/api/pipeline/assignments';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { DecomposedStep } from '@/lib/bindings/DecomposedStep';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { StudioMember, StudioUseCase } from './useTeamStudioData';

/**
 * Shared leaf components for the Team Studio variants. Extracted so the
 * Grid and Split layouts render the same member-tier chip, use-case
 * toggle row, and orchestration console rather than each reinventing
 * them.
 */

const TIER_TONE: Record<string, string> = {
  Opus: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  Sonnet: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  Haiku: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  Inherit: 'bg-secondary/40 text-foreground/60 border-primary/15',
};

export function MemberTierChip({ tier }: { tier: string }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full border typo-caption font-medium ${
        TIER_TONE[tier] ?? TIER_TONE.Inherit
      }`}
    >
      {tier}
    </span>
  );
}

export function TrustMeter({ score }: { score: number }) {
  // 0-100 trust score → 5 pips, mirrors the persona trust display language.
  const pips = Math.round((Math.max(0, Math.min(100, score)) / 100) * 5);
  return (
    <span className="inline-flex items-center gap-0.5" title={`Trust ${score}`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`w-1 h-1 rounded-full ${i < pips ? 'bg-emerald-400/80' : 'bg-foreground/15'}`}
        />
      ))}
    </span>
  );
}

interface UseCaseToggleRowProps {
  useCase: StudioUseCase;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  /** Compact = no description line (used in dense grid cells). */
  compact?: boolean;
}

export function UseCaseToggleRow({ useCase, busy, onToggle, compact }: UseCaseToggleRowProps) {
  const { enabled } = useCase;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onToggle(!enabled)}
      className={`group/uc w-full flex items-start gap-2 px-2 py-1.5 rounded-interactive text-left transition-colors disabled:opacity-60 ${
        enabled ? 'hover:bg-emerald-500/10' : 'hover:bg-secondary/30'
      }`}
      aria-pressed={enabled}
    >
      <span
        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
          enabled
            ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-300'
            : 'border-foreground/25 text-transparent'
        }`}
      >
        {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin text-foreground/60" /> : <Check className="w-2.5 h-2.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate typo-body font-medium ${
            enabled ? 'text-foreground' : 'text-foreground/45'
          }`}
        >
          {useCase.title}
        </span>
        {!compact && (useCase.capabilitySummary || useCase.description) && (
          <span className="block truncate typo-caption text-foreground/50">
            {useCase.capabilitySummary || useCase.description}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Add-member menu — self-contained roster add. Reads the agent store for
// personas not already on the team and calls the pipeline store's
// addTeamMember directly, so the studio owns roster management without
// depending on the canvas's picker handler.
// ---------------------------------------------------------------------------

interface AddMemberMenuProps {
  /** 'button' = standard pill; 'dashed' = full-width dashed row (list footer). */
  appearance?: 'button' | 'dashed';
}

export function AddMemberMenu({ appearance = 'button' }: AddMemberMenuProps) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const personas = useAgentStore((s) => s.personas);
  const teamMembers = usePipelineStore((s) => s.teamMembers) as PersonaTeamMember[];
  const addTeamMember = usePipelineStore((s) => s.addTeamMember);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const { available, excludedDrafts } = useMemo(() => {
    const taken = new Set(teamMembers.map((m) => m.persona_id));
    const candidates = personas.filter((p) => !taken.has(p.id));
    // Draft / not-yet-ready personas can't run inside an assignment — the
    // orchestrator rejects any member whose setup_status != "ready" (or that
    // is disabled). Exclude them here so they never get added in the first
    // place, and surface why with a hint.
    const ready = candidates.filter((p) => p.setup_status === 'ready' && p.enabled);
    return { available: ready, excludedDrafts: candidates.length - ready.length };
  }, [personas, teamMembers]);

  const handleAdd = useCallback(
    async (personaId: string) => {
      setAdding(true);
      try {
        await addTeamMember(personaId);
      } catch (err) {
        silentCatch('teamStudio/AddMemberMenu:add')(err);
      } finally {
        setAdding(false);
        setOpen(false);
      }
    },
    [addTeamMember],
  );

  const trigger =
    appearance === 'dashed' ? (
      <button
        type="button"
        data-testid="team-add-member"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-card border border-dashed border-primary/20 text-foreground/60 hover:bg-secondary/30 hover:text-foreground transition-colors typo-body"
      >
        <Plus className="w-4 h-4" />
        {ts.add_persona}
      </button>
    ) : (
      <button
        type="button"
        data-testid="team-add-member"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 bg-secondary/30 typo-body font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <Plus className="w-4 h-4" />
        {ts.add_persona}
      </button>
    );

  return (
    <div className="relative">
      {trigger}
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="absolute right-0 z-30 mt-1 w-64 max-h-80 overflow-y-auto rounded-card border border-primary/20 bg-background shadow-elevation-3 p-1"
            >
              {available.length === 0 ? (
                <p className="px-3 py-3 typo-caption text-foreground/50">
                  {ts.add_persona_none}
                </p>
              ) : (
                available.map((p) => (
                  <button
                    key={p.id}
                    data-testid="team-add-item"
                    type="button"
                    disabled={adding}
                    onClick={() => void handleAdd(p.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive text-left hover:bg-secondary/40 disabled:opacity-50 transition-colors"
                  >
                    <PersonaIcon icon={p.icon} color={p.color} display="pop" frameSize="sm" />
                    <span className="typo-body text-foreground truncate">{p.name}</span>
                  </button>
                ))
              )}
              {excludedDrafts > 0 && (
                <p data-testid="team-add-draft-hint" className="mt-1 border-t border-primary/10 px-3 pt-2 pb-1 typo-caption text-foreground/50">
                  {ts.add_persona_draft_hint}
                </p>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Orchestration console — the heart of the no-wiring assignment flow.
// Type a goal → decompose preview (which persona/use-case each step maps to)
// → run via companion_assign_team (decompose + create + start in one).
// ---------------------------------------------------------------------------

interface OrchestrationConsoleProps {
  teamId: string;
  members: StudioMember[];
  /** Layout hint — 'panel' fills a right pane, 'band' is a wide header strip. */
  layout?: 'panel' | 'band';
}

/** Per-step status dot + label. Status strings come straight from the
 *  orchestrator (TeamAssignmentStep.status); unknown values fall back to a
 *  neutral pending style. */
const STEP_STATUS_FALLBACK = { dot: 'bg-foreground/30', text: 'text-foreground/60' };
const STEP_STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  pending: STEP_STATUS_FALLBACK,
  matching: { dot: 'bg-amber-400', text: 'text-amber-300' },
  running: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-300' },
  done: { dot: 'bg-emerald-400', text: 'text-emerald-300' },
  skipped: { dot: 'bg-foreground/30', text: 'text-foreground/50' },
  failed: { dot: 'bg-red-400', text: 'text-red-300' },
  awaiting_review: { dot: 'bg-amber-400', text: 'text-amber-300' },
};

export function StepStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const labelMap: Record<string, string> = {
    pending: ts.step_status_pending,
    matching: ts.step_status_matching,
    running: ts.step_status_running,
    done: ts.step_status_done,
    skipped: ts.step_status_skipped,
    failed: ts.step_status_failed,
    awaiting_review: ts.step_status_awaiting_review,
  };
  const style = STEP_STATUS_STYLE[status] ?? STEP_STATUS_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 typo-caption ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {labelMap[status] ?? status}
    </span>
  );
}

export function OrchestrationConsole({ teamId, members }: OrchestrationConsoleProps) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const createAssignment = usePipelineStore((s) => s.createTeamAssignment);
  const startAssignment = usePipelineStore((s) => s.startAssignment);
  const [goal, setGoal] = useState('');
  const [decomposing, setDecomposing] = useState(false);
  const [steps, setSteps] = useState<DecomposedStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [launched, setLaunched] = useState<string | null>(null);
  // Live detail for the launched assignment — kept fresh by the global
  // progress listener (BackgroundServices) even if the user leaves this view.
  const liveDetail = usePipelineStore((s) => (launched ? s.assignmentDetails[launched] : undefined));

  const personaName = useCallback(
    (id: string | null) => (id ? members.find((m) => m.personaId === id)?.name ?? null : null),
    [members],
  );

  const handleDecompose = useCallback(async () => {
    if (!goal.trim()) return;
    setDecomposing(true);
    setSteps(null);
    setLaunched(null);
    try {
      const result = await decomposeTeamAssignmentGoal(teamId, goal.trim());
      setSteps(result);
    } catch (err) {
      silentCatch('teamStudio/OrchestrationConsole:decompose')(err);
      setSteps([]);
    } finally {
      setDecomposing(false);
    }
  }, [teamId, goal]);

  // Write the goal to the orchestration layer: decompose (if not already
  // previewed) into steps, then create + start a team assignment. Routing is
  // AI-resolved (Sonnet / llm_eval) and parallelism is unconstrained (the
  // MAX_PARALLEL ceiling), so there are no per-goal knobs here — the Claude
  // model is overridable in Workspace settings, not per-goal.
  const handleAssign = useCallback(async () => {
    const g = goal.trim();
    if (!g) return;
    setRunning(true);
    try {
      let decomposed = steps;
      if (!decomposed) {
        decomposed = await decomposeTeamAssignmentGoal(teamId, g);
        setSteps(decomposed);
      }
      const stepInputs = (decomposed ?? []).map((s) => ({
        title: s.title,
        description: s.description || null,
        // AI routing resolves the persona at match time; no manual binding.
        assignedPersonaId: null,
        assignedUseCaseId: null,
        dependsOnIndices: null,
      }));
      const assignment = await createAssignment({
        teamId,
        title: g.length > 60 ? `${g.slice(0, 57)}…` : g,
        goal: g,
        matchStrategy: 'llm_eval',
        maxParallelSteps: 16,
        source: 'team_ui',
        companionOpId: null,
        goalId: null,
        steps: stepInputs,
      });
      if (!assignment) return;
      // startAssignment caches the detail; the global listener keeps it live.
      await startAssignment(assignment.id);
      setLaunched(assignment.id);
    } catch (err) {
      silentCatch('teamStudio/OrchestrationConsole:assign')(err);
    } finally {
      setRunning(false);
    }
  }, [teamId, goal, steps, createAssignment, startAssignment]);

  // Guided empty state: tappable example goals (+ a one-line helper) shown only
  // while the user hasn't typed a goal and nothing is previewed/launched yet, so
  // a first-time user has a concrete model of what a good goal looks like
  // (restores the affordance the old CanvasAssistant offered pre-migration).
  const exampleGoals = [ts.example_goal_1, ts.example_goal_2, ts.example_goal_3, ts.example_goal_4];
  const showExamples = !goal.trim() && !launched && !steps;

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-300" />
        <h3 className="typo-label uppercase tracking-wider text-foreground/80">{ts.orchestrate}</h3>
        <span className="typo-caption text-foreground/50">{ts.orchestrate_subtitle}</span>
      </div>

      <textarea
        data-testid="team-goal-input"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        rows={4}
        placeholder={ts.orchestrate_placeholder}
        className="w-full resize-none rounded-input bg-secondary/30 border border-primary/20 text-foreground typo-body px-3 py-2 focus:outline-none focus:border-primary/60"
      />

      {showExamples && (
        <div className="flex flex-col gap-1.5 -mt-1">
          <p className="typo-caption text-foreground">{ts.examples_helper}</p>
          <div className="flex flex-wrap gap-1.5">
            {exampleGoals.map((ex) => (
              <button
                key={ex}
                type="button"
                data-testid="team-goal-example"
                onClick={() => setGoal(ex)}
                className="rounded-full border border-primary/15 bg-secondary/30 px-2.5 py-1 typo-caption text-foreground hover:bg-secondary/50 transition-colors"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="team-preview-button"
          disabled={!goal.trim() || decomposing}
          onClick={() => void handleDecompose()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 bg-secondary/30 typo-body font-medium text-foreground hover:bg-secondary/50 disabled:opacity-50 transition-colors"
        >
          {decomposing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleDot className="w-3.5 h-3.5" />}
          {ts.preview_routing}
        </button>
        <button
          type="button"
          data-testid="team-assign-button"
          disabled={!goal.trim() || running}
          onClick={() => void handleAssign()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-violet-500/30 bg-gradient-to-r from-violet-500/20 to-indigo-500/20 typo-body font-medium text-violet-200 hover:from-violet-500/30 hover:to-indigo-500/30 disabled:opacity-50 transition-colors"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
          {ts.assign_and_run}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <AnimatePresence mode="wait">
          {launched && (
            <motion.div
              key="live"
              data-testid="team-live-checklist"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center justify-between">
                <span className="typo-label uppercase tracking-wider text-foreground/70">{ts.checklist_heading}</span>
                <span className="typo-caption text-foreground/50">{ts.checklist_background_note}</span>
              </div>
              {(liveDetail?.steps ?? []).length === 0 ? (
                <p className="typo-body text-foreground/50 px-1">{ts.assignment_dispatched}</p>
              ) : (
                (liveDetail?.steps ?? []).map((step, i) => {
                  const who = personaName(step.assignedPersonaId);
                  return (
                    <div key={step.id} className="rounded-card border border-primary/12 bg-secondary/20 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary typo-caption font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="typo-body font-medium text-foreground truncate flex-1">{step.title}</span>
                        {who && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 typo-caption text-indigo-300">
                            → {who}
                          </span>
                        )}
                        <StepStatusBadge status={step.status} />
                      </div>
                      {step.description && (
                        <p className="mt-1 pl-7 typo-caption text-foreground/55 line-clamp-2">{step.description}</p>
                      )}
                    </div>
                  );
                })
              )}
            </motion.div>
          )}

          {steps && !launched && (
            <motion.div
              key="steps"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2"
            >
              {steps.length === 0 ? (
                <p className="typo-body text-foreground/50 px-1">{ts.no_routing}</p>
              ) : (
                steps.map((step, i) => {
                  const who = personaName(step.suggestedPersonaId);
                  return (
                    <div
                      key={i}
                      className="rounded-card border border-primary/12 bg-secondary/20 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary typo-caption font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                        <span className="typo-body font-medium text-foreground truncate flex-1">
                          {step.title}
                        </span>
                        {who ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 typo-caption text-indigo-300">
                            → {who}
                          </span>
                        ) : (
                          <span className="typo-caption text-amber-300/80">{ts.step_unrouted}</span>
                        )}
                      </div>
                      {step.description && (
                        <p className="mt-1 pl-7 typo-caption text-foreground/55 line-clamp-2">
                          {step.description}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
