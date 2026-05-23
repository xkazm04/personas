import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Sparkles, X } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTeamStudioData } from './useTeamStudioData';
import {
  MemberTierChip,
  TrustMeter,
  UseCaseToggleRow,
  OrchestrationConsole,
  AddMemberMenu,
} from './teamStudioShared';
import type { StudioMember } from './useTeamStudioData';

/**
 * GRID variant — "fleet board".
 *
 * Metaphor: a powered-up Persona Monitor grid specific to one team.
 * Each cell is a member persona showing identity, model tier, trust,
 * and its use-cases as inline toggles (the capability surface lives ON
 * the card, not behind a drawer). Orchestration is a collapsible band
 * above the grid — type a goal, see it routed, run it — so the
 * "assignment in → orchestrator picks persona" flow is one keystroke
 * away from the roster it draws from.
 *
 * Differs from baseline (React Flow DAG): no edges, no canvas, no
 * hand-wiring. Density + direct capability control replace topology.
 */

interface TeamStudioGridVariantProps {
  teamId: string;
  teamName: string;
}

export function TeamStudioGridVariant({ teamId, teamName }: TeamStudioGridVariantProps) {
  const { members, toggleUseCase, busyUseCases } = useTeamStudioData();
  const [orchestrateOpen, setOrchestrateOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-5 py-3 border-b border-primary/10">
        <div className="min-w-0">
          <h2 className="typo-heading font-semibold text-foreground truncate">{teamName}</h2>
          <p className="typo-caption text-foreground/60">
            {members.length} {members.length === 1 ? 'member' : 'members'} ·{' '}
            {members.reduce((a, m) => a + m.activeUseCaseCount, 0)} active capabilities
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOrchestrateOpen((p) => !p)}
            aria-pressed={orchestrateOpen}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border typo-body font-medium transition-colors ${
              orchestrateOpen
                ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
                : 'border-primary/20 bg-secondary/30 text-foreground hover:bg-secondary/50'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Orchestrate
          </button>
          <AddMemberMenu appearance="button" />
        </div>
      </div>

      {/* Orchestration band */}
      {orchestrateOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex-shrink-0 border-b border-primary/10 bg-secondary/10 overflow-hidden"
        >
          <div className="px-5 py-4 relative">
            <button
              type="button"
              onClick={() => setOrchestrateOpen(false)}
              className="absolute top-3 right-4 p-1 rounded-full text-foreground/50 hover:bg-secondary/40 hover:text-foreground transition-colors"
              aria-label="Close orchestration"
            >
              <X className="w-4 h-4" />
            </button>
            <OrchestrationConsole teamId={teamId} members={members} layout="band" />
          </div>
        </motion.div>
      )}

      {/* Grid body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {members.length === 0 ? (
          <EmptyRoster />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {members.map((m) => (
              <MemberCell
                key={m.memberId}
                member={m}
                busyUseCases={busyUseCases}
                onToggle={(ucId, enabled) => void toggleUseCase(m.personaId, ucId, enabled)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemberCell({
  member,
  busyUseCases,
  onToggle,
}: {
  member: StudioMember;
  busyUseCases: ReadonlySet<string>;
  onToggle: (useCaseId: string, enabled: boolean) => void;
}) {
  return (
    <div className="flex flex-col rounded-card border border-primary/12 bg-secondary/15 overflow-hidden">
      {/* Identity row */}
      <div
        className="flex items-center gap-2.5 px-3 py-2.5 border-b border-primary/8"
        style={member.color ? { borderLeft: `3px solid ${member.color}` } : undefined}
      >
        <PersonaIcon icon={member.icon} color={member.color} display="pop" frameSize="sm" />
        <div className="min-w-0 flex-1">
          <div className="typo-body font-semibold text-foreground truncate">{member.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {member.presetRole && (
              <span className="typo-caption text-foreground/55 uppercase tracking-wider truncate max-w-[90px]">
                {member.presetRole}
              </span>
            )}
            <TrustMeter score={member.trustScore} />
          </div>
        </div>
        <MemberTierChip tier={member.modelTier} />
      </div>

      {/* Capability toggles */}
      <div className="flex-1 px-1.5 py-1.5">
        {member.useCases.length === 0 ? (
          <p className="px-2 py-2 typo-caption text-foreground/40">No capabilities defined.</p>
        ) : (
          <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto">
            {member.useCases.map((uc) => (
              <UseCaseToggleRow
                key={uc.id}
                useCase={uc}
                compact
                busy={busyUseCases.has(`${member.personaId}:${uc.id}`)}
                onToggle={(enabled) => onToggle(uc.id, enabled)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer count */}
      <div className="flex-shrink-0 px-3 py-1.5 border-t border-primary/8 typo-caption text-foreground/50">
        {member.activeUseCaseCount}/{member.useCases.length} capabilities active
      </div>
    </div>
  );
}

function EmptyRoster() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
      <div className="w-14 h-14 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Plus className="w-7 h-7 text-primary/50" />
      </div>
      <p className="typo-body text-foreground/60 max-w-xs">
        This team has no personas yet. Add members to build its roster.
      </p>
      <AddMemberMenu appearance="button" />
    </div>
  );
}
