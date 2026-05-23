import { useEffect, useState } from 'react';
import { Sparkles, SlidersHorizontal } from 'lucide-react';
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
 * SPLIT variant — "console".
 *
 * Metaphor: an IDE-like two-pane workspace. Left = the team roster
 * (scrollable persona list with at-a-glance tier + active-capability
 * count). Right = a dynamic pane that flips between two modes:
 *   - ADJUST: the selected member's capability toggles + identity.
 *   - ORCHESTRATE: the assignment console (goal → routed steps → run).
 *
 * Differs from baseline (DAG) and from the Grid variant: deep focus on
 * ONE member at a time on the right, with orchestration as a peer mode
 * rather than a band. Better for teams with many capabilities per
 * persona where the grid cells would overflow.
 */

interface TeamStudioSplitVariantProps {
  teamId: string;
  teamName: string;
}

type RightMode = { kind: 'member'; memberId: string } | { kind: 'orchestrate' };

export function TeamStudioSplitVariant({ teamId, teamName }: TeamStudioSplitVariantProps) {
  const { members, toggleUseCase, busyUseCases } = useTeamStudioData();
  const [mode, setMode] = useState<RightMode>({ kind: 'orchestrate' });

  // Default-select the first member once the roster loads (but keep
  // orchestrate as the initial mode so the assignment box is the first
  // thing the user sees — the primary action).
  useEffect(() => {
    if (mode.kind === 'member' && !members.some((m) => m.memberId === mode.memberId)) {
      setMode({ kind: 'orchestrate' });
    }
  }, [members, mode]);

  const selected =
    mode.kind === 'member' ? members.find((m) => m.memberId === mode.memberId) ?? null : null;

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* Left — roster */}
      <div className="flex-shrink-0 w-[300px] flex flex-col border-r border-primary/10 bg-secondary/10">
        <div className="flex-shrink-0 px-4 py-3 border-b border-primary/10">
          <h2 className="typo-heading font-semibold text-foreground truncate">{teamName}</h2>
          <p className="typo-caption text-foreground/60">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </p>
        </div>

        {/* Orchestrate entry — pinned at top of the list as the primary action */}
        <button
          type="button"
          onClick={() => setMode({ kind: 'orchestrate' })}
          aria-pressed={mode.kind === 'orchestrate'}
          className={`flex-shrink-0 mx-2 mt-2 mb-1 flex items-center gap-2 px-3 py-2.5 rounded-card border transition-colors ${
            mode.kind === 'orchestrate'
              ? 'border-violet-500/40 bg-gradient-to-r from-violet-500/15 to-indigo-500/15 text-violet-200'
              : 'border-primary/15 bg-secondary/20 text-foreground hover:bg-secondary/40'
          }`}
        >
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          <span className="typo-body font-medium">Orchestrate an assignment</span>
        </button>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {members.map((m) => (
            <RosterRow
              key={m.memberId}
              member={m}
              selected={mode.kind === 'member' && mode.memberId === m.memberId}
              onClick={() => setMode({ kind: 'member', memberId: m.memberId })}
            />
          ))}
          <div className="mt-1">
            <AddMemberMenu appearance="dashed" />
          </div>
        </div>
      </div>

      {/* Right — dynamic pane */}
      <div className="flex-1 min-h-0 overflow-hidden px-5 py-4">
        {mode.kind === 'orchestrate' ? (
          <OrchestrationConsole teamId={teamId} members={members} layout="panel" />
        ) : selected ? (
          <MemberAdjustPane
            member={selected}
            busyUseCases={busyUseCases}
            onToggle={(ucId, enabled) => void toggleUseCase(selected.personaId, ucId, enabled)}
          />
        ) : (
          <div className="h-full flex items-center justify-center typo-body text-foreground/40">
            Select a member to adjust its capabilities.
          </div>
        )}
      </div>
    </div>
  );
}

function RosterRow({
  member,
  selected,
  onClick,
}: {
  member: StudioMember;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-card border text-left transition-colors ${
        selected
          ? 'border-primary/40 bg-secondary/40'
          : 'border-transparent hover:bg-secondary/25'
      }`}
    >
      <PersonaIcon icon={member.icon} color={member.color} display="pop" frameSize="sm" />
      <div className="min-w-0 flex-1">
        <div className="typo-body font-medium text-foreground truncate">{member.name}</div>
        <div className="typo-caption text-foreground/50">
          {member.activeUseCaseCount}/{member.useCases.length} active
        </div>
      </div>
      <MemberTierChip tier={member.modelTier} />
    </button>
  );
}

function MemberAdjustPane({
  member,
  busyUseCases,
  onToggle,
}: {
  member: StudioMember;
  busyUseCases: ReadonlySet<string>;
  onToggle: (useCaseId: string, enabled: boolean) => void;
}) {
  return (
    <div className="h-full flex flex-col gap-4">
      {/* Identity header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <PersonaIcon icon={member.icon} color={member.color} display="pop" frameSize="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="typo-heading font-semibold text-foreground truncate">{member.name}</h3>
            <MemberTierChip tier={member.modelTier} />
          </div>
          <div className="flex items-center gap-2 mt-1">
            {member.presetRole && (
              <span className="typo-caption text-foreground/55 uppercase tracking-wider">
                {member.presetRole}
              </span>
            )}
            <TrustMeter score={member.trustScore} />
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <SlidersHorizontal className="w-4 h-4 text-foreground/60" />
        <h4 className="typo-label uppercase tracking-wider text-foreground/80">Capabilities</h4>
        <span className="typo-caption text-foreground/50">
          {member.activeUseCaseCount} of {member.useCases.length} active
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 pr-1">
        {member.useCases.length === 0 ? (
          <p className="typo-body text-foreground/40 px-2">This persona has no capabilities defined.</p>
        ) : (
          member.useCases.map((uc) => (
            <div key={uc.id} className="rounded-card border border-primary/8 bg-secondary/15">
              <UseCaseToggleRow
                useCase={uc}
                busy={busyUseCases.has(`${member.personaId}:${uc.id}`)}
                onToggle={(enabled) => onToggle(uc.id, enabled)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
