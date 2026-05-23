import { useEffect, useMemo, useState } from 'react';
import { Plus, Users, Zap, Trash2, ArrowRight, Layers } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { usePipelineStore } from '@/stores/pipelineStore';
import { AutoTeamModal } from './AutoTeamModal';
import { CreateTeamForm } from './CreateTeamForm';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

/**
 * Teams management table — the landing view of the "Teams" sidebar
 * entry (no team selected). Overview + create + disband.
 *
 * "Disband" deletes the PersonaTeam (and cascades its membership +
 * connections) but NOT the member personas — they survive ungrouped,
 * exactly like removing a folder without deleting its files. Wired to
 * `delete_team`, whose FK cascade only removes `persona_team_members`
 * rows, never the personas they point at.
 *
 * The old hardcoded PipelineTemplateGallery ("starter pipelines") was
 * removed here — Team Template Presets are the intended creation entry
 * point going forward.
 */
export default function TeamList() {
  const { t } = useTranslation();
  const teams = usePipelineStore((s) => s.teams);
  const teamCounts = usePipelineStore((s) => s.teamCounts);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const createTeam = usePipelineStore((s) => s.createTeam);
  const deleteTeam = usePipelineStore((s) => s.deleteTeam);
  const selectTeam = usePipelineStore((s) => s.selectTeam);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [confirmDisbandId, setConfirmDisbandId] = useState<string | null>(null);
  const [showAutoTeam, setShowAutoTeam] = useState(false);

  // Auto-revert disband confirmation after 3.5s so a stray click doesn't
  // leave a primed delete button hanging.
  useEffect(() => {
    if (!confirmDisbandId) return;
    const timer = setTimeout(() => setConfirmDisbandId(null), 3500);
    return () => clearTimeout(timer);
  }, [confirmDisbandId]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createTeam({
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      color: newColor,
    });
    setNewName('');
    setNewDescription('');
    setNewColor('#6366f1');
    setShowCreate(false);
  };

  const handleDisband = async (id: string) => {
    await deleteTeam(id);
    setConfirmDisbandId(null);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full p-6">
          <div className="max-w-4xl 2xl:max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="typo-heading-lg font-bold text-foreground/90">{t.pipeline.agent_teams}</h1>
                <p className="typo-body text-foreground mt-1">{t.pipeline.agent_teams_subtitle}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="accent"
                  size="sm"
                  icon={<Zap className="w-4 h-4" />}
                  onClick={() => setShowAutoTeam(true)}
                >
                  {t.pipeline.auto_team}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="w-4 h-4" />}
                  onClick={() => setShowCreate(true)}
                >
                  {t.pipeline.new_team}
                </Button>
              </div>
            </div>

            {showCreate && (
              <div className="mb-5">
                <CreateTeamForm
                  newName={newName} onNameChange={setNewName}
                  newDescription={newDescription} onDescriptionChange={setNewDescription}
                  newColor={newColor} onColorChange={setNewColor}
                  onSubmit={handleCreate} onCancel={() => setShowCreate(false)}
                />
              </div>
            )}

            {sortedTeams.length === 0 && !showCreate ? (
              <EmptyState onCreate={() => setShowCreate(true)} onAuto={() => setShowAutoTeam(true)} t={t} />
            ) : (
              <div className="rounded-card border border-primary/12 overflow-hidden">
                {/* Column header */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-2 bg-secondary/20 border-b border-primary/10 typo-label uppercase tracking-wider text-foreground/55">
                  <span>{t.pipeline.agent_teams}</span>
                  <span className="text-right w-20">Members</span>
                  <span className="text-right w-20">Status</span>
                  <span className="w-[150px]" />
                </div>
                {sortedTeams.map((team) => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    counts={teamCounts[team.id]}
                    confirmingDisband={confirmDisbandId === team.id}
                    onOpen={() => selectTeam(team.id)}
                    onRequestDisband={() => setConfirmDisbandId(team.id)}
                    onCancelDisband={() => setConfirmDisbandId(null)}
                    onConfirmDisband={() => void handleDisband(team.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <AutoTeamModal open={showAutoTeam} onClose={() => setShowAutoTeam(false)} />
    </div>
  );
}

interface TeamRowProps {
  team: PersonaTeam;
  counts: { members: number; connections: number } | undefined;
  confirmingDisband: boolean;
  onOpen: () => void;
  onRequestDisband: () => void;
  onCancelDisband: () => void;
  onConfirmDisband: () => void;
}

function TeamRow({
  team,
  counts,
  confirmingDisband,
  onOpen,
  onRequestDisband,
  onCancelDisband,
  onConfirmDisband,
}: TeamRowProps) {
  const memberCount = counts?.members ?? 0;
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-2.5 border-b border-primary/8 last:border-b-0 hover:bg-secondary/15 transition-colors">
      {/* Identity */}
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-2.5 min-w-0 text-left group/row"
        style={{ borderLeft: undefined }}
      >
        <span
          className="flex-shrink-0 w-7 h-7 rounded-interactive flex items-center justify-center border"
          style={{
            backgroundColor: `${team.color}1f`,
            borderColor: `${team.color}40`,
            color: team.color,
          }}
        >
          {team.icon ? <span className="text-sm leading-none">{team.icon}</span> : <Layers className="w-3.5 h-3.5" />}
        </span>
        <span className="min-w-0">
          <span className="block typo-body font-medium text-foreground truncate group-hover/row:text-primary transition-colors">
            {team.name}
          </span>
          {team.description && (
            <span className="block typo-caption text-foreground/50 truncate">{team.description}</span>
          )}
        </span>
      </button>

      {/* Members */}
      <span className="w-20 text-right inline-flex items-center justify-end gap-1 typo-body text-foreground/70">
        <Users className="w-3.5 h-3.5 text-foreground/40" />
        {memberCount}
      </span>

      {/* Status */}
      <span className="w-20 text-right">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full border typo-caption ${
            team.enabled
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-secondary/40 text-foreground/50 border-primary/15'
          }`}
        >
          {team.enabled ? 'Active' : 'Draft'}
        </span>
      </span>

      {/* Actions */}
      <span className="w-[150px] flex items-center justify-end gap-1.5">
        {confirmingDisband ? (
          <>
            <button
              type="button"
              onClick={onConfirmDisband}
              className="px-2 py-1 rounded-interactive border border-red-500/40 bg-red-500/15 text-red-300 typo-caption font-medium hover:bg-red-500/25 transition-colors"
            >
              Disband
            </button>
            <button
              type="button"
              onClick={onCancelDisband}
              className="px-2 py-1 rounded-interactive border border-primary/15 text-foreground/60 typo-caption hover:bg-secondary/40 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/20 bg-secondary/30 text-foreground typo-caption font-medium hover:bg-secondary/50 transition-colors"
            >
              Open <ArrowRight className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={onRequestDisband}
              aria-label="Disband team"
              title="Disband team (keeps personas)"
              className="p-1 rounded-interactive text-foreground/40 hover:bg-red-500/15 hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function EmptyState({
  onCreate,
  onAuto,
  t,
}: {
  onCreate: () => void;
  onAuto: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="animate-fade-slide-in text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 rounded-modal bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
        <Users className="w-8 h-8 text-indigo-400/50" />
      </div>
      <h2 className="typo-heading-lg font-semibold text-foreground/90 mb-1">{t.pipeline.no_teams_yet}</h2>
      <p className="typo-body text-foreground mb-6 max-w-sm mx-auto">{t.pipeline.no_teams_hint}</p>
      <div className="flex items-center justify-center gap-3">
        <Button variant="accent" size="sm" icon={<Zap className="w-4 h-4" />} onClick={onAuto}>
          {t.pipeline.auto_team}
        </Button>
        <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={onCreate}>
          {t.pipeline.create_blank_team}
        </Button>
      </div>
    </div>
  );
}
