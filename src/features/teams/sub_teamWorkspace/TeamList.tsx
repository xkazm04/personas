import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Users, Zap, Trash2, ArrowRight, Layers, PenLine } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { hasUnsentDraft } from '../sub_collab/useTeamChannel';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useVaultStore } from '@/stores/vaultStore';
import { listCredentials } from '@/api/vault/credentials';
import { listTeamMembers } from '@/api/pipeline/teams';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { AutoTeamModal } from './AutoTeamModal';
import { CreateTeamForm } from './CreateTeamForm';
import { usePersonaIndex } from './teamStudio/boardShared';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';

/**
 * Teams management table — the landing view of the "Teams" sidebar
 * entry (no team selected). Standard ContentHeader + overview table +
 * create + disband.
 *
 * "Disband" deletes the PersonaTeam (cascading its membership +
 * connections) but NOT the member personas — they survive ungrouped,
 * like removing a folder without deleting its files. Wired to
 * `delete_team`, whose FK cascade only removes `persona_team_members`
 * rows, never the personas they point at.
 */
export default function TeamList() {
  const { t, tx } = useTranslation();
  const ts = t.pipeline.team_studio;
  const teams = usePipelineStore((s) => s.teams);
  const teamCounts = usePipelineStore((s) => s.teamCounts);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const createTeam = usePipelineStore((s) => s.createTeam);
  const deleteTeam = usePipelineStore((s) => s.deleteTeam);
  const selectTeam = usePipelineStore((s) => s.selectTeam);
  const setPresetFlowOpen = usePipelineStore((s) => s.setPresetFlowOpen);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  // Codebase repository for the new team (provisions a Codebase connector).
  const [newGithubUrl, setNewGithubUrl] = useState('');
  const [newPrCred, setNewPrCred] = useState<string | null>(null);
  const [newMainBranch, setNewMainBranch] = useState('');
  const [githubCreds, setGithubCreds] = useState<{ id: string; name: string }[]>([]);
  const [confirmDisbandId, setConfirmDisbandId] = useState<string | null>(null);
  const [showAutoTeam, setShowAutoTeam] = useState(false);
  const personaIndex = usePersonaIndex();

  useEffect(() => {
    if (!confirmDisbandId) return;
    const timer = setTimeout(() => setConfirmDisbandId(null), 3500);
    return () => clearTimeout(timer);
  }, [confirmDisbandId]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  // Load GitHub PAT credentials when the create form opens so the repo picker
  // can authenticate and list repositories.
  useEffect(() => {
    if (!showCreate) return;
    listCredentials()
      .then((creds) =>
        setGithubCreds(
          creds
            .filter((c) => c.serviceType === 'github' || c.serviceType === 'github_actions')
            .map((c) => ({ id: c.id, name: c.name })),
        ),
      )
      .catch(silentCatch('TeamList:listGithubCreds'));
  }, [showCreate]);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  // Teams with an unsent channel draft persisted locally — surfaced as a
  // small pen hint on the row so a half-written directive isn't forgotten.
  // localStorage is read on mount/teams-change; the list remounts on
  // navigation, which is when drafts can have changed.
  const draftTeamIds = useMemo(
    () => new Set(teams.filter((tm) => hasUnsentDraft(tm.id)).map((tm) => tm.id)),
    [teams],
  );

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const team = await createTeam({
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      color: newColor,
    });
    // Provision a Codebase connector wired to the chosen GitHub repo so the
    // team carries a single source-control truth (consumed by Dev Tools'
    // "Team" source mode). Repo-centric: no local root_path at team level.
    if (team && newGithubUrl.trim()) {
      const data: Record<string, string> = {
        project_name: newName.trim(),
        team_id: team.id,
        github_url: newGithubUrl.trim(),
        mode: 'team',
      };
      if (newMainBranch.trim()) data.main_branch = newMainBranch.trim();
      try {
        await useVaultStore.getState().createCredential({
          name: `Codebase — ${newName.trim()}`,
          service_type: 'codebase',
          data,
        });
      } catch (err) {
        toastCatch('Failed to create Codebase connector')(err);
      }
    }
    setNewName('');
    setNewDescription('');
    setNewColor('#6366f1');
    setNewGithubUrl('');
    setNewPrCred(null);
    setNewMainBranch('');
    setShowCreate(false);
  };

  const handleDisband = async (id: string) => {
    await deleteTeam(id);
    setConfirmDisbandId(null);
  };

  const countLabel = tx(
    teams.length === 1 ? ts.teams_count_one : ts.teams_count_other,
    { count: teams.length },
  );

  return (
    <ContentBox minWidth={0} data-testid="teams-table">
      <ContentHeader
        icon={<Users className="w-5 h-5 text-indigo-300" />}
        iconColor="indigo"
        title={ts.teams_header_label}
        subtitle={countLabel}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Layers className="w-4 h-4" />} onClick={() => setPresetFlowOpen(true)} data-testid="team-preset-btn">
              {t.pipeline.preset_team}
            </Button>
            <Button variant="accent" size="sm" icon={<Zap className="w-4 h-4" />} onClick={() => setShowAutoTeam(true)}>
              {t.pipeline.auto_team}
            </Button>
            <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
              {t.pipeline.new_team}
            </Button>
          </div>
        }
      />

      <ContentBody>
        {showCreate && (
          <div className="mb-5">
            <CreateTeamForm
              newName={newName} onNameChange={setNewName}
              newDescription={newDescription} onDescriptionChange={setNewDescription}
              newColor={newColor} onColorChange={setNewColor}
              onSubmit={handleCreate} onCancel={() => setShowCreate(false)}
              existingNames={teams.map((tm) => tm.name)}
              githubCreds={githubCreds}
              prCredentialId={newPrCred}
              onCredChange={setNewPrCred}
              githubUrl={newGithubUrl}
              onGithubUrlChange={setNewGithubUrl}
              mainBranch={newMainBranch}
              onMainBranchChange={setNewMainBranch}
            />
          </div>
        )}

        {sortedTeams.length === 0 && !showCreate ? (
          <EmptyState
            onCreate={() => setShowCreate(true)}
            onAuto={() => setShowAutoTeam(true)}
            onPreset={() => setPresetFlowOpen(true)}
            t={t}
          />
        ) : (
          <div className="rounded-card border border-primary/12 overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-2 bg-secondary/20 border-b border-primary/10 typo-label uppercase tracking-wider text-foreground">
              <span>{t.pipeline.agent_teams}</span>
              <span className="text-right w-20">{ts.col_members}</span>
              <span className="text-right w-20">{ts.col_status}</span>
              <span className="w-[150px]" />
            </div>
            {sortedTeams.map((team) => (
              <TeamRow
                key={team.id}
                team={team}
                counts={teamCounts[team.id]}
                hasDraft={draftTeamIds.has(team.id)}
                personaIndex={personaIndex}
                confirmingDisband={confirmDisbandId === team.id}
                onOpen={() => selectTeam(team.id)}
                onRequestDisband={() => setConfirmDisbandId(team.id)}
                onCancelDisband={() => setConfirmDisbandId(null)}
                onConfirmDisband={() => void handleDisband(team.id)}
                ts={ts}
              />
            ))}
          </div>
        )}
      </ContentBody>

      <AutoTeamModal open={showAutoTeam} onClose={() => setShowAutoTeam(false)} />
    </ContentBox>
  );
}

type TeamStudioStrings = ReturnType<typeof useTranslation>['t']['pipeline']['team_studio'];

interface TeamRowProps {
  team: PersonaTeam;
  counts: { members: number; connections: number } | undefined;
  hasDraft: boolean;
  personaIndex: ReturnType<typeof usePersonaIndex>;
  confirmingDisband: boolean;
  onOpen: () => void;
  onRequestDisband: () => void;
  onCancelDisband: () => void;
  onConfirmDisband: () => void;
  ts: TeamStudioStrings;
}

function TeamRow({
  team,
  counts,
  hasDraft,
  personaIndex,
  confirmingDisband,
  onOpen,
  onRequestDisband,
  onCancelDisband,
  onConfirmDisband,
  ts,
}: TeamRowProps) {
  const memberCount = counts?.members ?? 0;
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-2.5 border-b border-primary/8 last:border-b-0 hover:bg-secondary/15 transition-colors">
      <button type="button" onClick={onOpen} className="flex items-center gap-2.5 min-w-0 text-left group/row">
        <span
          className="flex-shrink-0 w-7 h-7 rounded-interactive flex items-center justify-center border"
          style={{ backgroundColor: `${team.color}1f`, borderColor: `${team.color}40`, color: team.color }}
        >
          {team.icon ? <span className="typo-body leading-none">{team.icon}</span> : <Layers className="w-3.5 h-3.5" />}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="typo-body font-medium text-foreground truncate group-hover/row:text-primary transition-colors">
              {team.name}
            </span>
            {hasDraft && (
              <Tooltip content={ts.unsent_draft_hint}>
                <PenLine className="w-3 h-3 text-amber-300/80 flex-shrink-0" aria-label={ts.unsent_draft_hint} />
              </Tooltip>
            )}
          </span>
          {team.description && (
            <span className="block typo-caption text-foreground truncate">{team.description}</span>
          )}
        </span>
      </button>

      <MembersHoverPreview teamId={team.id} memberCount={memberCount} personaIndex={personaIndex} />

      <span className="w-20 text-right">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full border typo-caption ${
            team.enabled
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-secondary/40 text-foreground/50 border-primary/15'
          }`}
        >
          {team.enabled ? ts.status_active : ts.status_draft}
        </span>
      </span>

      <span className="w-[150px] flex items-center justify-end gap-1.5">
        {confirmingDisband ? (
          <>
            <button
              type="button"
              onClick={onConfirmDisband}
              className="px-2 py-1 rounded-interactive border border-red-500/40 bg-red-500/15 text-red-300 typo-caption font-medium hover:bg-red-500/25 transition-colors"
            >
              {ts.disband}
            </button>
            <button
              type="button"
              onClick={onCancelDisband}
              className="px-2 py-1 rounded-interactive border border-primary/15 text-foreground typo-caption hover:bg-secondary/40 transition-colors"
            >
              {ts.cancel}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/20 bg-secondary/30 text-foreground typo-caption font-medium hover:bg-secondary/50 transition-colors"
            >
              {ts.open} <ArrowRight className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onRequestDisband}
              aria-label={ts.disband}
              title={ts.disband_title}
              className="p-1 rounded-interactive text-foreground hover:bg-red-500/15 hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * Member-count cell with a lazy hover popover: who's on this team and in what
 * role, without opening the studio. Members fetch once per row on first hover.
 */
function MembersHoverPreview({ teamId, memberCount, personaIndex }: {
  teamId: string;
  memberCount: number;
  personaIndex: ReturnType<typeof usePersonaIndex>;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<PersonaTeamMember[] | null>(null);
  const fetchedRef = useRef(false);

  const onEnter = () => {
    setOpen(true);
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    listTeamMembers(teamId)
      .then(setMembers)
      .catch(silentCatch('TeamList:membersPreview'));
  };

  return (
    <span
      className="relative w-20 text-right inline-flex items-center justify-end gap-1 typo-body text-foreground"
      onMouseEnter={onEnter}
      onMouseLeave={() => setOpen(false)}
    >
      <Users className="w-3.5 h-3.5 text-foreground" />
      {memberCount}
      {open && memberCount > 0 && (
        <div className="absolute right-0 top-full mt-1 z-30 min-w-52 rounded-card border border-border bg-secondary/95 backdrop-blur-md shadow-elevation-3 p-1.5 flex flex-col gap-0.5 text-left">
          {members === null ? (
            <div className="flex justify-center py-1.5"><LoadingSpinner size="xs" /></div>
          ) : (
            <>
              {members.slice(0, 8).map((m) => {
                const p = personaIndex.get(m.persona_id);
                return (
                  <div key={m.id} className="flex items-center gap-2 px-1.5 py-0.5">
                    <PersonaIcon icon={p?.icon ?? null} color={p?.color ?? null} size="w-4 h-4" />
                    <span className="typo-caption text-foreground truncate flex-1">{p?.name.replace(/^T: /, '') ?? m.persona_id}</span>
                    <span className="typo-caption font-mono text-foreground bg-secondary/50 px-1.5 py-0.5 rounded flex-shrink-0">{m.role}</span>
                  </div>
                );
              })}
              {members.length > 8 && (
                <span className="px-1.5 typo-caption text-foreground tabular-nums">+{members.length - 8}</span>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}

function EmptyState({
  onCreate,
  onAuto,
  onPreset,
  t,
}: {
  onCreate: () => void;
  onAuto: () => void;
  onPreset: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="animate-fade-slide-in text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 rounded-modal bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
        <Users className="w-8 h-8 text-indigo-400/50" />
      </div>
      <h2 className="typo-heading-lg font-semibold text-foreground/90 mb-1">{t.pipeline.no_teams_yet}</h2>
      <p className="typo-body text-foreground mb-6 max-w-sm mx-auto">{t.pipeline.no_teams_hint}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" size="sm" icon={<Layers className="w-4 h-4" />} onClick={onPreset}>
          {t.pipeline.preset_team}
        </Button>
        <Button variant="accent" size="sm" icon={<Zap className="w-4 h-4" />} onClick={onAuto}>
          {t.pipeline.auto_team}
        </Button>
        <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={onCreate}>
          {t.pipeline.create_blank_team}
        </Button>
      </div>
    </div>
  );
}
