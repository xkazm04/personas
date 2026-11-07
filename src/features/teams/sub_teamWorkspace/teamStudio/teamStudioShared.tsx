import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { useCallback, useMemo, useState } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import Button from '@/features/shared/components/buttons/Button';
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

export function MemberTierChip({ tier }: { tier: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-interactive border border-hair typo-code text-ink-2">
      {tier}
    </span>
  );
}

export function TrustMeter({ score }: { score: number }) {
  // 0-100 trust score → 5 pips, mirrors the persona trust display language.
  const pips = Math.round((Math.max(0, Math.min(100, score)) / 100) * 5);
  return (
    <Tooltip content={`Trust ${score}`}><span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`w-1 h-1 rounded-full ${i < pips ? 'bg-status-success/80' : 'bg-foreground/15'}`}
        />
      ))}
    </span></Tooltip>
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
    <PressSurface
      disabled={busy}
      onPress={() => onToggle(!enabled)}
      className={`group/uc w-full flex items-start gap-2 px-2 py-1.5 rounded-interactive    ${
        enabled ? 'hover:bg-status-success/10' : 'hover:bg-surface-2'
      }`}
      aria-pressed={enabled}
    >
      <span
        className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
          enabled
            ? 'bg-status-success/25 border-status-success/50 text-status-success'
            : 'border-foreground/25 text-transparent'
        }`}
      >
        {busy ? <Loader2 className="w-2.5 h-2.5 animate-spin text-foreground" /> : <Check className="w-2.5 h-2.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate typo-body ${
            enabled ? 'text-foreground' : 'text-ink-3'
          }`}
        >
          {useCase.title}
        </span>
        {!compact && (useCase.capabilitySummary || useCase.description) && (
          <span className="block typo-caption text-ink-2">
            {useCase.capabilitySummary || useCase.description}
          </span>
        )}
      </span>
    </PressSurface>
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
      <Button variant="secondary" size="sm" className="w-full" data-testid="team-add-member" onClick={() => setOpen((p) => !p)} icon={<Plus className="w-4 h-4" />}>
{ts.add_persona}
</Button>
    ) : (
      <Button variant="secondary" size="sm" data-testid="team-add-member" onClick={() => setOpen((p) => !p)} icon={<Plus className="w-4 h-4" />}>
{ts.add_persona}
</Button>
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
              className="absolute right-0 z-30 mt-1 w-64 max-h-80 overflow-y-auto rounded-card border border-hair bg-background shadow-elevation-3 p-1"
            >
              {available.length === 0 ? (
                <p className="px-3 py-3 typo-caption text-ink-2">
                  {ts.add_persona_none}
                </p>
              ) : (
                available.map((p) => (
                  <PressSurface
                    key={p.id}
                    data-testid="team-add-item"
                    disabled={adding}
                    onPress={() => void handleAdd(p.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-interactive"
                  >
                    <PersonaIcon icon={p.icon} color={p.color} display="pop" frameSize="sm" />
                    <span className="typo-body text-foreground truncate">{p.name}</span>
                  </PressSurface>
                ))
              )}
              {excludedDrafts > 0 && (
                <p data-testid="team-add-draft-hint" className="mt-1 border-t border-hair px-3 pt-2 pb-1 typo-caption text-ink-2">
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
