import { useEffect, useMemo, useState } from 'react';
import { Layers, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { silentCatch } from '@/lib/silentCatch';

const PERSONA_DRAG_MIME = 'application/x-personas-persona-id';

/**
 * Horizontal rail of group chips that act as drop targets for persona
 * cards dragged from `PersonaOverviewVariantGrid`. Each chip carries the
 * group's color stripe and current count; a trailing "Ungrouped" chip
 * lets the user clear `group_id` by dropping a persona there.
 *
 * Renders only when at least one group exists OR a persona is currently
 * grouped — there's no point showing the rail in a vanilla install with
 * no groups configured.
 */
export function PersonaGroupDropRail() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const movePersonaToGroup = usePipelineStore((s) => s.movePersonaToGroup);
  const { groups, fetchGroups } = usePipelineStore(
    useShallow((s) => ({ groups: s.groups, fetchGroups: s.fetchGroups })),
  );
  const addToast = useToastStore((s) => s.addToast);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sortOrder - b.sortOrder),
    [groups],
  );

  const countByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of personas) {
      if (p.group_id) m.set(p.group_id, (m.get(p.group_id) ?? 0) + 1);
    }
    return m;
  }, [personas]);
  const ungroupedCount = useMemo(
    () => personas.filter((p) => !p.group_id).length,
    [personas],
  );

  // Hide the rail entirely if there are no groups AND no grouped personas —
  // it would just be visual clutter in a vanilla install.
  if (sortedGroups.length === 0 && ungroupedCount === personas.length) {
    return null;
  }

  const handleDrop = (groupId: string | null, e: React.DragEvent) => {
    e.preventDefault();
    setHoverId(null);
    const personaId = e.dataTransfer.getData(PERSONA_DRAG_MIME);
    if (!personaId) return;
    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return;
    if (persona.group_id === groupId) return; // no-op same target
    void (async () => {
      try {
        await movePersonaToGroup(personaId, groupId);
        const targetName = groupId
          ? sortedGroups.find((g) => g.id === groupId)?.name ?? ''
          : t.agents.persona_groups_rail.ungrouped_label;
        addToast(
          tx(t.agents.persona_groups_rail.moved_toast, {
            persona: persona.name,
            group: targetName,
          }),
          'success',
        );
      } catch (err) {
        silentCatch('features/agents/components/allPersonas/PersonaGroupDropRail:drop')(err);
      }
    })();
  };

  const dragOverProps = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      // Only accept the persona MIME type to avoid catching unrelated drags.
      if (e.dataTransfer.types.includes(PERSONA_DRAG_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (hoverId !== id) setHoverId(id);
      }
    },
    onDragLeave: () => {
      if (hoverId === id) setHoverId(null);
    },
  });

  return (
    <div
      role="region"
      aria-label={t.agents.persona_groups_rail.aria_label}
      className="flex items-center gap-2 px-3 py-2 border-b border-primary/5 overflow-x-auto"
    >
      <span className="flex items-center gap-1.5 typo-label text-foreground/60 uppercase tracking-wider flex-shrink-0">
        <Layers className="w-3 h-3" />
        {t.agents.persona_groups_rail.heading}
      </span>
      {sortedGroups.map((g) => {
        const isHover = hoverId === g.id;
        const count = countByGroup.get(g.id) ?? 0;
        return (
          <div
            key={g.id}
            {...dragOverProps(g.id)}
            onDrop={(e) => handleDrop(g.id, e)}
            className={`group/chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border typo-caption font-medium flex-shrink-0 transition-all ${
              isHover ? 'scale-105 ring-2 ring-offset-1 ring-offset-background' : ''
            }`}
            style={{
              backgroundColor: colorWithAlpha(g.color || '#6366f1', isHover ? 0.25 : 0.12),
              borderColor: colorWithAlpha(g.color || '#6366f1', isHover ? 0.7 : 0.4),
              color: g.color || '#6366f1',
            }}
            title={t.agents.persona_groups_rail.chip_title}
          >
            <Users className="w-3 h-3" />
            <span>{g.name}</span>
            <span className="text-foreground/60 typo-label font-mono">{count}</span>
          </div>
        );
      })}
      <div
        {...dragOverProps('__ungrouped__')}
        onDrop={(e) => handleDrop(null, e)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/15 bg-secondary/30 typo-caption font-medium text-foreground flex-shrink-0 transition-all ${
          hoverId === '__ungrouped__' ? 'scale-105 ring-2 ring-offset-1 ring-offset-background ring-foreground/40' : ''
        }`}
        title={t.agents.persona_groups_rail.ungrouped_title}
      >
        <span>{t.agents.persona_groups_rail.ungrouped_label}</span>
        <span className="text-foreground/60 typo-label font-mono">{ungroupedCount}</span>
      </div>
    </div>
  );
}
