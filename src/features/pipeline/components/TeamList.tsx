import { useEffect, useMemo, useState } from 'react';
import { Plus, Users, Zap } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { usePipelineStore } from "@/stores/pipelineStore";
import { updateTeam } from "@/api/pipeline/teams";

import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { serializeTeamConfig } from '@/lib/types/teamConfigTypes';
import type { TeamConfig } from '@/lib/types/teamConfigTypes';
import PipelineTemplateGallery from './templates/PipelineTemplateGallery';
import type { PipelineTemplate } from './templates/PipelineTemplateGallery';
import { AutoTeamModal } from './AutoTeamModal';
import { CreateTeamForm } from './CreateTeamForm';
import { TeamCard } from './TeamCard';
import { useTranslation } from '@/i18n/useTranslation';

export default function TeamList() {
  const { t } = useTranslation();
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const createTeam = usePipelineStore((s) => s.createTeam);
  const deleteTeam = usePipelineStore((s) => s.deleteTeam);
  const cloneTeam = usePipelineStore((s) => s.cloneTeam);
  const selectTeam = usePipelineStore((s) => s.selectTeam);

  const parentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) map.set(t.id, t.name);
    return map;
  }, [teams]);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showAutoTeam, setShowAutoTeam] = useState(false);

  // Auto-revert confirm state after 3 seconds
  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createTeam({ name: newName.trim(), description: newDescription.trim() || undefined, color: newColor });
    setNewName('');
    setNewDescription('');
    setNewColor('#6366f1');
    setShowCreate(false);
  };

  const handleAdoptTemplate = async (template: PipelineTemplate) => {
    const blueprint: TeamConfig = {
      template_id: template.id,
      nodes: template.nodes,
      edges: template.edges,
    };
    const team = await createTeam({
      name: template.name,
      description: template.description,
      color: template.color,
      icon: template.icon,
    });
    if (team) {
      try {
        await updateTeam(team.id, {
          name: null,
          description: null,
          canvas_data: null,
          team_config: serializeTeamConfig(blueprint),
          icon: null,
          color: null,
          enabled: null,
        });
      } catch {
        // intentional: non-critical
      }
      selectTeam(team.id);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
      <div className="min-h-full p-6">
      <div className="max-w-4xl 2xl:max-w-6xl 3xl:max-w-7xl 4xl:max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground/90">{t.pipeline.agent_teams}</h1>
            <p className="text-sm text-muted-foreground/80 mt-1">
              {t.pipeline.agent_teams_subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="accent"
              size="sm"
              icon={<Zap className="w-4 h-4" />}
              onClick={() => setShowAutoTeam(true)}
              className="bg-gradient-to-r from-violet-500/15 to-indigo-500/15 border border-violet-500/25 text-violet-300 hover:from-violet-500/25 hover:to-indigo-500/25"
            >
              {t.pipeline.auto_team}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setShowCreate(true)}
              className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25"
            >
              {t.pipeline.new_team}
            </Button>
          </div>
        </div>

        {/* Create Form */}
        {showCreate && (
          <CreateTeamForm
            newName={newName} onNameChange={setNewName}
            newDescription={newDescription} onDescriptionChange={setNewDescription}
            newColor={newColor} onColorChange={setNewColor}
            onSubmit={handleCreate} onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Team Grid */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {teams.map((team: PersonaTeam) => (
            <TeamCard
              key={team.id}
              team={team}
              parentTeamName={team.parent_team_id ? (parentNameMap.get(team.parent_team_id) ?? null) : null}
              confirmDeleteId={confirmDeleteId}
              onSelect={selectTeam}
              onClone={cloneTeam}
              onDelete={deleteTeam}
              onConfirmDelete={setConfirmDeleteId}
            />
          ))}
        </div>

        {/* Empty State */}
        {teams.length === 0 && !showCreate && (
          <div className="animate-fade-slide-in text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Users className="w-8 h-8 text-indigo-400/50" />
            </div>
            <h2 className="text-lg font-semibold text-foreground/90 mb-1">{t.pipeline.no_teams_yet}</h2>
            <p className="text-sm text-muted-foreground/90 mb-6 max-w-sm mx-auto">
              {t.pipeline.no_teams_hint}
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="accent"
                size="sm"
                icon={<Zap className="w-4 h-4" />}
                onClick={() => setShowAutoTeam(true)}
                className="bg-gradient-to-r from-violet-500/15 to-indigo-500/15 border border-violet-500/25 text-violet-300 hover:from-violet-500/25 hover:to-indigo-500/25"
              >
                {t.pipeline.auto_team}
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setShowCreate(true)}
                className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25"
              >
                {t.pipeline.create_blank_team}
              </Button>
            </div>
          </div>
        )}

        {/* Pipeline Template Gallery */}
        <div className={teams.length > 0 ? 'mt-8' : 'mt-4'}>
          <PipelineTemplateGallery onAdopt={handleAdoptTemplate} />
        </div>
      </div>
      </div>
      </div>

      <AutoTeamModal open={showAutoTeam} onClose={() => setShowAutoTeam(false)} />
    </div>
  );
}
