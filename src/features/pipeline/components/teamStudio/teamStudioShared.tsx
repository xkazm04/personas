import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Sparkles, ArrowRight, Check, CircleDot, Plus } from 'lucide-react';
import { decomposeTeamAssignmentGoal, companionAssignTeam } from '@/api/pipeline/assignments';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
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
  const personas = useAgentStore((s) => s.personas);
  const teamMembers = usePipelineStore((s) => s.teamMembers) as PersonaTeamMember[];
  const addTeamMember = usePipelineStore((s) => s.addTeamMember);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const available = useMemo(() => {
    const taken = new Set(teamMembers.map((m) => m.persona_id));
    return personas.filter((p) => !taken.has(p.id));
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
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-card border border-dashed border-primary/20 text-foreground/60 hover:bg-secondary/30 hover:text-foreground transition-colors typo-body"
      >
        <Plus className="w-4 h-4" />
        Add persona
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 bg-secondary/30 typo-body font-medium text-foreground hover:bg-secondary/50 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add persona
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
                  Every persona is already on this team.
                </p>
              ) : (
                available.map((p) => (
                  <button
                    key={p.id}
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

export function OrchestrationConsole({ teamId, members, layout = 'panel' }: OrchestrationConsoleProps) {
  const [goal, setGoal] = useState('');
  const [decomposing, setDecomposing] = useState(false);
  const [steps, setSteps] = useState<DecomposedStep[] | null>(null);
  const [running, setRunning] = useState(false);
  const [launched, setLaunched] = useState<string | null>(null);

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

  const handleRun = useCallback(async () => {
    if (!goal.trim()) return;
    setRunning(true);
    try {
      const res = await companionAssignTeam(teamId, goal.trim());
      setLaunched(res.assignmentId);
    } catch (err) {
      silentCatch('teamStudio/OrchestrationConsole:run')(err);
    } finally {
      setRunning(false);
    }
  }, [teamId, goal]);

  return (
    <div className={layout === 'band' ? 'flex flex-col gap-3' : 'flex flex-col gap-4 h-full'}>
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-300" />
        <h3 className="typo-label uppercase tracking-wider text-foreground/80">Orchestrate</h3>
        <span className="typo-caption text-foreground/50">
          Describe the goal — the orchestrator routes it to the right personas.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={layout === 'band' ? 2 : 3}
          placeholder="e.g. Pull this week's customer feedback, triage the top themes, and draft a backlog summary."
          className="w-full resize-none rounded-input bg-secondary/30 border border-primary/20 text-foreground typo-body px-3 py-2 focus:outline-none focus:border-primary/60"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!goal.trim() || decomposing}
            onClick={() => void handleDecompose()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 bg-secondary/30 typo-body font-medium text-foreground hover:bg-secondary/50 disabled:opacity-50 transition-colors"
          >
            {decomposing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CircleDot className="w-3.5 h-3.5" />}
            Preview routing
          </button>
          <button
            type="button"
            disabled={!goal.trim() || running}
            onClick={() => void handleRun()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-violet-500/30 bg-gradient-to-r from-violet-500/20 to-indigo-500/20 typo-body font-medium text-violet-200 hover:from-violet-500/30 hover:to-indigo-500/30 disabled:opacity-50 transition-colors"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
            Assign &amp; run
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {launched && (
          <motion.div
            key="launched"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-card border border-emerald-500/25 bg-emerald-950/30 px-3 py-2 typo-body text-emerald-300"
          >
            Assignment dispatched — the orchestrator is routing steps to members now.
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
              <p className="typo-body text-foreground/50 px-1">
                No routing produced — try a more specific goal.
              </p>
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
                        <span className="typo-caption text-amber-300/80">unrouted</span>
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
  );
}
