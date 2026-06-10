import { useEffect, useRef, useState } from 'react';
import { Sparkles, SlidersHorizontal, ArrowLeft, Users, Settings, LayoutGrid, Radio, MessagesSquare, Brain } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTeamStudioData } from './useTeamStudioData';
import { TeamWorkspacePane } from './TeamWorkspacePane';
import { TeamAssignmentBoard } from './TeamAssignmentBoard';
import { RedRoomPane } from '../../sub_redRoom/RedRoomPane';
import { CollabPane } from '../../sub_collab/CollabPane';
import { TeamMemoryPane } from '../../sub_teamMemory/TeamMemoryPane';
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
  /** Return to the Teams table (deselect the team). */
  onBack?: () => void;
}

type RightMode = { kind: 'member'; memberId: string } | { kind: 'orchestrate' } | { kind: 'board' } | { kind: 'redroom' } | { kind: 'collab' } | { kind: 'memory' } | { kind: 'workspace' };

export function TeamStudioSplitVariant({ teamId, teamName, onBack }: TeamStudioSplitVariantProps) {
  const { t, tx } = useTranslation();
  const ts = t.pipeline.team_studio;
  const { members, toggleUseCase, busyUseCases } = useTeamStudioData();
  const [mode, setMode] = useState<RightMode>({ kind: 'orchestrate' });

  // The studio header wears the team's identity — the icon and color that
  // became editable in Workspace settings show up where the user works.
  const team = usePipelineStore((s) => s.teams.find((x) => x.id === teamId)) ?? null;
  const teamAccent = team?.color ?? '#6366f1';

  // Unsaved-changes guard: the workspace pane reports its dirty flag up; any
  // navigation away while dirty detours through a confirm instead of silently
  // unmounting the pane (and the edits with it).
  const workspaceDirty = useRef(false);
  const [pendingNav, setPendingNav] = useState<RightMode | 'back' | null>(null);
  const requestMode = (next: RightMode) => {
    if (mode.kind === 'workspace' && workspaceDirty.current && next.kind !== 'workspace') setPendingNav(next);
    else setMode(next);
  };
  const requestBack = () => {
    if (mode.kind === 'workspace' && workspaceDirty.current) setPendingNav('back');
    else onBack?.();
  };
  const confirmNav = () => {
    workspaceDirty.current = false;
    if (pendingNav === 'back') onBack?.();
    else if (pendingNav) setMode(pendingNav);
    setPendingNav(null);
  };

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

  const memberCountLabel = tx(
    members.length === 1 ? ts.members_count_one : ts.members_count_other,
    { count: members.length },
  );

  return (
    <>
      <ContentHeader
        icon={
          <span
            className="w-9 h-9 rounded-card border flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${teamAccent}26`, borderColor: `${teamAccent}59` }}
          >
            {team?.icon ? (
              <span aria-hidden className="typo-body-lg leading-none">{team.icon}</span>
            ) : (
              <Users className="w-5 h-5" style={{ color: teamAccent }} />
            )}
          </span>
        }
        title={ts.header_label}
        subtitle={teamName}
        actions={
          onBack ? (
            <button
              type="button"
              onClick={requestBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 bg-secondary/30 typo-body font-medium text-foreground hover:bg-secondary/50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {ts.teams_header_label}
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left — navigation + roster, sectioned so the eye separates
            WORKSPACE (navigation) from MEMBERS (data) like an IDE sidebar. */}
        <div className="flex-shrink-0 w-[300px] flex flex-col border-r border-primary/10 bg-secondary/10">
          {/* WORKSPACE — the mode trio, tightened into one distinct group. */}
          <div className="flex-shrink-0 px-3 pt-3 pb-2">
            <p className="px-1 mb-1.5 typo-label uppercase tracking-wider text-foreground">
              {ts.section_workspace}
            </p>
            <div className="flex flex-col gap-0.5 rounded-card bg-secondary/20 p-1">
              {/* Orchestrate — the primary action */}
              <button
                type="button"
                data-testid="team-mode-orchestrate"
                onClick={() => requestMode({ kind: 'orchestrate' })}
                aria-pressed={mode.kind === 'orchestrate'}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border transition-colors ${
                  mode.kind === 'orchestrate'
                    ? 'border-violet-500/40 bg-gradient-to-r from-violet-500/15 to-indigo-500/15 text-violet-200'
                    : 'border-transparent text-foreground hover:bg-secondary/40'
                }`}
              >
                <Sparkles className="w-4 h-4 flex-shrink-0" />
                <span className="typo-body font-medium">{ts.orchestrate_assignment}</span>
              </button>

              {/* Assignment board — manage the team's multiple assignments */}
              <button
                type="button"
                data-testid="team-mode-board"
                onClick={() => requestMode({ kind: 'board' })}
                aria-pressed={mode.kind === 'board'}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border transition-colors ${
                  mode.kind === 'board'
                    ? 'border-primary/40 bg-secondary/40 text-foreground/90'
                    : 'border-transparent text-foreground hover:bg-secondary/40'
                }`}
              >
                <LayoutGrid className="w-4 h-4 flex-shrink-0" />
                <span className="typo-body font-medium">{ts.board_label}</span>
              </button>

              {/* Red Room — the team's communication channel */}
              <button
                type="button"
                data-testid="team-mode-redroom"
                onClick={() => requestMode({ kind: 'redroom' })}
                aria-pressed={mode.kind === 'redroom'}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border transition-colors ${
                  mode.kind === 'redroom'
                    ? 'border-primary/40 bg-secondary/40 text-foreground/90'
                    : 'border-transparent text-foreground hover:bg-secondary/40'
                }`}
              >
                <Radio className="w-4 h-4 flex-shrink-0" />
                <span className="typo-body font-medium">{ts.red_room_label}</span>
              </button>

              {/* Collab — living-chat design comparison (mock) */}
              <button
                type="button"
                data-testid="team-mode-collab"
                onClick={() => requestMode({ kind: 'collab' })}
                aria-pressed={mode.kind === 'collab'}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border transition-colors ${
                  mode.kind === 'collab'
                    ? 'border-primary/40 bg-secondary/40 text-foreground/90'
                    : 'border-transparent text-foreground hover:bg-secondary/40'
                }`}
              >
                <MessagesSquare className="w-4 h-4 flex-shrink-0" />
                <span className="typo-body font-medium">{ts.collab_label}</span>
              </button>

              {/* Team memory — the shared ledger (decisions / constraints / learnings) */}
              <button
                type="button"
                data-testid="team-mode-memory"
                onClick={() => requestMode({ kind: 'memory' })}
                aria-pressed={mode.kind === 'memory'}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border transition-colors ${
                  mode.kind === 'memory'
                    ? 'border-primary/40 bg-secondary/40 text-foreground/90'
                    : 'border-transparent text-foreground hover:bg-secondary/40'
                }`}
              >
                <Brain className="w-4 h-4 flex-shrink-0" />
                <span className="typo-body font-medium">{ts.memory_label}</span>
              </button>

              {/* Workspace settings */}
              <button
                type="button"
                data-testid="team-mode-workspace"
                onClick={() => requestMode({ kind: 'workspace' })}
                aria-pressed={mode.kind === 'workspace'}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border transition-colors ${
                  mode.kind === 'workspace'
                    ? 'border-primary/40 bg-secondary/40 text-foreground/90'
                    : 'border-transparent text-foreground hover:bg-secondary/40'
                }`}
              >
                <Settings className="w-4 h-4 flex-shrink-0" />
                <span className="typo-body font-medium">{ts.workspace_settings}</span>
              </button>
            </div>
          </div>

          {/* Hairline divider — navigation above, member data below. */}
          <div className="flex-shrink-0 border-t border-primary/10" />

          {/* MEMBERS — the roster */}
          <div className="flex-shrink-0 px-3 pt-3 pb-1.5 flex items-center justify-between gap-2">
            <p className="px-1 typo-label uppercase tracking-wider text-foreground">
              {ts.section_members}
            </p>
            <span className="typo-caption text-foreground">{memberCountLabel}</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
            {members.map((m) => (
              <RosterRow
                key={m.memberId}
                member={m}
                selected={mode.kind === 'member' && mode.memberId === m.memberId}
                onClick={() => requestMode({ kind: 'member', memberId: m.memberId })}
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
          ) : mode.kind === 'board' ? (
            <TeamAssignmentBoard teamId={teamId} />
          ) : mode.kind === 'redroom' ? (
            <RedRoomPane teamId={teamId} members={members} />
          ) : mode.kind === 'collab' ? (
            <CollabPane teamId={teamId} members={members} />
          ) : mode.kind === 'memory' ? (
            <TeamMemoryPane teamId={teamId} onClose={() => setMode({ kind: 'orchestrate' })} />
          ) : mode.kind === 'workspace' ? (
            <TeamWorkspacePane teamId={teamId} onDirtyChange={(d) => { workspaceDirty.current = d; }} />
          ) : selected ? (
            <MemberAdjustPane
              member={selected}
              busyUseCases={busyUseCases}
              onToggle={(ucId, enabled) => void toggleUseCase(selected.personaId, ucId, enabled)}
            />
          ) : (
            <div className="h-full flex items-center justify-center typo-body text-foreground">
              {ts.select_member}
            </div>
          )}
        </div>
      </div>

      {pendingNav !== null && (
        <ConfirmDialog
          title={ts.workspace_unsaved_title}
          body={ts.workspace_unsaved_body}
          danger
          confirmLabel={ts.workspace_unsaved_discard}
          cancelLabel={ts.workspace_unsaved_stay}
          onConfirm={confirmNav}
          onCancel={() => setPendingNav(null)}
        />
      )}
    </>
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
  const { t, tx } = useTranslation();
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
        <div className="typo-caption text-foreground">
          {tx(t.pipeline.team_studio.capabilities_active, {
            active: member.activeUseCaseCount,
            total: member.useCases.length,
          })}
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
  const { t, tx } = useTranslation();
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
              <span className="typo-caption text-foreground uppercase tracking-wider">
                {member.presetRole}
              </span>
            )}
            <TrustMeter score={member.trustScore} />
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <SlidersHorizontal className="w-4 h-4 text-foreground" />
        <h4 className="typo-label uppercase tracking-wider text-foreground">{t.pipeline.team_studio.capabilities}</h4>
        <span className="typo-caption text-foreground">
          {tx(t.pipeline.team_studio.capabilities_active, {
            active: member.activeUseCaseCount,
            total: member.useCases.length,
          })}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 pr-1">
        {member.useCases.length === 0 ? (
          <p className="typo-body text-foreground px-2">{t.pipeline.team_studio.no_capabilities_persona}</p>
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
