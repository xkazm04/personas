import { useEffect, useMemo, useState } from 'react';
import { Plus, Layers } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import { GroupCard } from './GroupCard';
import { GroupEditModal } from './GroupEditModal';
import { GroupMemoryListModal } from './GroupMemoryListModal';

/**
 * Persona group manager — the missing UI surface for PersonaGroups.
 *
 * Backed by the existing `groupSlice` on `pipelineStore`. Persona-count
 * column comes from joining `useAgentStore.personas` on `group_id`, so the
 * count refreshes when a persona is moved between groups elsewhere in the
 * app (e.g. drag in the All Personas view, set via persona editor).
 */
export default function GroupManagerPage() {
  const { t } = useTranslation();
  const groups = usePipelineStore((s) => s.groups);
  const fetchGroups = usePipelineStore((s) => s.fetchGroups);
  const deleteGroup = usePipelineStore((s) => s.deleteGroup);
  const personas = useAgentStore((s) => s.personas);

  const [editing, setEditing] = useState<PersonaGroup | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [memoriesForGroup, setMemoriesForGroup] = useState<PersonaGroup | null>(null);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  const personaCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of personas) {
      if (!p.group_id) continue;
      counts.set(p.group_id, (counts.get(p.group_id) ?? 0) + 1);
    }
    return counts;
  }, [personas]);

  const ungroupedCount = useMemo(
    () => personas.filter((p) => !p.group_id).length,
    [personas],
  );

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sortOrder - b.sortOrder),
    [groups],
  );

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (group: PersonaGroup) => {
    setEditing(group);
    setModalOpen(true);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full p-6">
          <div className="max-w-4xl 2xl:max-w-6xl 3xl:max-w-7xl 4xl:max-w-[1800px] mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="typo-heading-lg font-bold text-foreground/90">
                  {t.pipeline.groups.page_title}
                </h1>
                <p className="typo-body text-foreground mt-1">
                  {t.pipeline.groups.page_subtitle}
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
                onClick={openCreate}
                className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25"
              >
                {t.pipeline.groups.create_group}
              </Button>
            </div>

            {/* Ungrouped chip — informational, not a real group */}
            {ungroupedCount > 0 && (
              <div className="mb-4 p-3 rounded-card bg-secondary/30 border border-primary/10 flex items-center gap-3">
                <div className="w-8 h-8 rounded-card bg-foreground/5 flex items-center justify-center">
                  <Layers className="w-4 h-4 text-foreground" />
                </div>
                <div className="flex-1">
                  <div className="typo-heading text-foreground/90">
                    {t.pipeline.groups.ungrouped_label}
                  </div>
                  <div className="typo-label text-foreground">
                    {t.pipeline.groups.ungrouped_hint}
                  </div>
                </div>
                <div className="typo-body text-foreground font-mono">{ungroupedCount}</div>
              </div>
            )}

            {/* Group grid */}
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
              {sortedGroups.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  personaCount={personaCountByGroup.get(group.id) ?? 0}
                  confirmDeleteId={confirmDeleteId}
                  onEdit={openEdit}
                  onDelete={deleteGroup}
                  onConfirmDelete={setConfirmDeleteId}
                  onOpenMemories={setMemoriesForGroup}
                />
              ))}
            </div>

            {/* Empty state */}
            {sortedGroups.length === 0 && (
              <div className="animate-fade-slide-in text-center py-12">
                <div className="w-16 h-16 mx-auto mb-4 rounded-modal bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Layers className="w-8 h-8 text-indigo-400/50" />
                </div>
                <h2 className="typo-heading-lg font-semibold text-foreground/90 mb-1">
                  {t.pipeline.groups.empty_title}
                </h2>
                <p className="typo-body text-foreground mb-6 max-w-sm mx-auto">
                  {t.pipeline.groups.empty_hint}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="w-4 h-4" />}
                  onClick={openCreate}
                  className="bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/25"
                >
                  {t.pipeline.groups.create_group}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <GroupEditModal
        open={modalOpen}
        group={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
      />

      {memoriesForGroup && (
        <GroupMemoryListModal
          open
          group={memoriesForGroup}
          onClose={() => setMemoriesForGroup(null)}
        />
      )}
    </div>
  );
}
