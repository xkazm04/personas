import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, Plus } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { StudioUseCase } from './useTeamStudioData';

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
        {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin text-foreground" /> : <Check className="w-2.5 h-2.5" />}
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
          <span className="block truncate typo-caption text-foreground">
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
        className="w-full flex items-center gap-2 px-3 py-2 rounded-card border border-dashed border-primary/20 text-foreground hover:bg-secondary/30 hover:text-foreground transition-colors typo-body"
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
                <p className="px-3 py-3 typo-caption text-foreground">
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
                <p data-testid="team-add-draft-hint" className="mt-1 border-t border-primary/10 px-3 pt-2 pb-1 typo-caption text-foreground">
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
