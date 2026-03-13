import { useState, useMemo, useCallback, useRef } from 'react';
import { DndContext, DragOverlay, closestCenter, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { SidebarPersonaCard } from '@/features/agents/components/sub_sidebar/components/DraggablePersonaCard';
import { DroppableGroup } from '@/features/agents/components/sub_sidebar/components/DroppableGroup';
import { UngroupedZone } from '@/features/agents/components/sub_sidebar/components/UngroupedZone';
import type { DragPayload, SidebarNode } from '@/lib/types/frontendTypes';
import type { Persona } from '@/lib/types/types';
import { getDragPayload, getDropPayload, resolveDropGroupId } from './sidebarDragHelpers';

interface SidebarDndSectionProps {
  visibleGroupNodes: SidebarNode[];
  ungrouped: Persona[];
  handleContextMenu: (e: React.MouseEvent, persona: Persona) => void;
}

export function SidebarDndSection({ visibleGroupNodes, ungrouped, handleContextMenu }: SidebarDndSectionProps) {
  const personas = useAgentStore((s) => s.personas);
  const groups = usePipelineStore((s) => s.groups);
  const selectedPersonaId = useAgentStore((s) => s.selectedPersonaId);
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const updateGroup = usePipelineStore((s) => s.updateGroup);
  const deleteGroup = usePipelineStore((s) => s.deleteGroup);
  const reorderGroups = usePipelineStore((s) => s.reorderGroups);
  const movePersonaToGroup = usePipelineStore((s) => s.movePersonaToGroup);

  const [activeId, setActiveId] = useState<string | null>(null);
  const dragStartGroupIdsRef = useRef<string[]>([]);
  const activeDragRef = useRef<DragPayload | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.sortOrder - b.sortOrder), [groups]);

  const activeDrag = activeDragRef.current;
  const activePersona = activeDrag?.type === 'persona'
    ? personas.find(p => p.id === activeDrag.personaId) : null;
  const activeGroup = activeDrag?.type === 'group-reorder'
    ? sortedGroups.find(g => g.id === activeDrag.groupId) : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    dragStartGroupIdsRef.current = sortedGroups.map(g => g.id);
    activeDragRef.current = getDragPayload(event);
    setActiveId(String(event.active.id));
  }, [sortedGroups]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    activeDragRef.current = null;
    setActiveId(null);
    const drag = getDragPayload(event);
    const drop = getDropPayload(event);
    if (!drag || !drop) return;

    if (drag.type === 'group-reorder') {
      const targetGroupId = (drop.type === 'group' || drop.type === 'group-reorder') ? drop.groupId : null;
      if (targetGroupId && drag.groupId !== targetGroupId) {
        const ids = [...dragStartGroupIdsRef.current];
        const fromIdx = ids.indexOf(drag.groupId);
        const toIdx = ids.indexOf(targetGroupId);
        if (fromIdx !== -1 && toIdx !== -1) {
          ids.splice(fromIdx, 1);
          ids.splice(toIdx, 0, drag.groupId);
          reorderGroups(ids);
        }
      }
      return;
    }

    const targetGroupId = resolveDropGroupId(drop, personas);
    const currentPersona = personas.find(p => p.id === drag.personaId);
    if (currentPersona && (currentPersona.group_id || null) !== targetGroupId) {
      movePersonaToGroup(drag.personaId, targetGroupId);
    }
  }, [personas, movePersonaToGroup, reorderGroups]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {visibleGroupNodes.map((node) => {
        if (node.kind !== 'group') return null;
        return (
          <DroppableGroup
            key={node.group.id}
            group={node.group}
            personas={node.children}
            selectedPersonaId={selectedPersonaId}
            onSelectPersona={selectPersona}
            onToggleCollapse={() => updateGroup(node.group.id, { collapsed: !node.group.collapsed })}
            onRename={(name) => updateGroup(node.group.id, { name })}
            onDelete={() => deleteGroup(node.group.id)}
            onUpdateWorkspace={(updates) => updateGroup(node.group.id, updates)}
            isDragActive={!!activeId}
            onPersonaContextMenu={handleContextMenu}
          />
        );
      })}

      <UngroupedZone
        ungrouped={ungrouped}
        groupsLength={groups.length}
        activeId={activeId}
        selectedPersonaId={selectedPersonaId}
        selectPersona={selectPersona}
        handleContextMenu={handleContextMenu}
      />

      <DragOverlay>
        {activePersona && (
          <motion.div className="opacity-85 pointer-events-none" initial={{ rotate: 0, scale: 1 }} animate={{ rotate: 2, scale: 1.01 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}>
            <SidebarPersonaCard persona={activePersona} isSelected={false} onClick={() => {}} />
          </motion.div>
        )}
        {activeGroup && (
          <div className="opacity-80 pointer-events-none rounded-xl border border-primary/20 bg-secondary/40 px-3 py-2 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeGroup.color }} />
            <span className="text-sm font-medium text-foreground/90">{activeGroup.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
