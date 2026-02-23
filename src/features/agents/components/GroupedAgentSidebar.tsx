import { useState, useMemo, useCallback, useRef } from 'react';
import { DndContext, DragOverlay, closestCenter, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, LayoutGrid, FolderPlus, X, Check } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { DraggablePersonaCard, SidebarPersonaCard } from '@/features/agents/components/sub_sidebar/DraggablePersonaCard';
import { DroppableGroup } from '@/features/agents/components/sub_sidebar/DroppableGroup';
import { PersonaContextMenu, type ContextMenuState } from '@/features/agents/components/sub_sidebar/PersonaContextMenu';
import type { DbPersona } from '@/lib/types/types';

// ── Color palette for groups ──────────────────────────────────────
const GROUP_COLORS = [
  '#6B7280', '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444',
  '#F59E0B', '#10B981', '#06B6D4', '#6366F1', '#F97316',
];

// ── Main GroupedAgentSidebar ─────────────────────────────────────
interface GroupedAgentSidebarProps {
  onCreatePersona: () => void;
}

export default function GroupedAgentSidebar({ onCreatePersona }: GroupedAgentSidebarProps) {
  const personas = usePersonaStore((s) => s.personas);
  const groups = usePersonaStore((s) => s.groups);
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const createGroup = usePersonaStore((s) => s.createGroup);
  const updateGroup = usePersonaStore((s) => s.updateGroup);
  const deleteGroup = usePersonaStore((s) => s.deleteGroup);
  const reorderGroups = usePersonaStore((s) => s.reorderGroups);
  const movePersonaToGroup = usePersonaStore((s) => s.movePersonaToGroup);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, persona: DbPersona) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ persona, x: e.clientX, y: e.clientY });
  }, []);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Group personas
  const grouped = useMemo(() => {
    const map = new Map<string | null, DbPersona[]>();
    map.set(null, []); // ungrouped
    for (const g of groups) map.set(g.id, []);
    for (const p of personas) {
      const key = p.group_id || null;
      if (!map.has(key)) map.set(null, [...(map.get(null) || []), p]);
      else map.get(key)!.push(p);
    }
    return map;
  }, [personas, groups]);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.sort_order - b.sort_order);
  }, [groups]);

  const ungrouped = grouped.get(null) || [];

  const activePersona = activeId ? personas.find(p => p.id === activeId) : null;
  const activeGroup = activeId?.startsWith('group-drag:')
    ? sortedGroups.find(g => g.id === activeId.replace('group-drag:', ''))
    : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeIdStr = String(active.id);
    const overId = String(over.id);

    // ── Group reordering ──
    if (activeIdStr.startsWith('group-drag:')) {
      const draggedGroupId = activeIdStr.replace('group-drag:', '');
      let targetGroupId: string | null = null;
      if (overId.startsWith('group-drag:')) {
        targetGroupId = overId.replace('group-drag:', '');
      } else if (overId.startsWith('group:')) {
        targetGroupId = overId.replace('group:', '');
      }
      if (targetGroupId && draggedGroupId !== targetGroupId) {
        const ids = sortedGroups.map(g => g.id);
        const fromIdx = ids.indexOf(draggedGroupId);
        const toIdx = ids.indexOf(targetGroupId);
        if (fromIdx !== -1 && toIdx !== -1) {
          ids.splice(fromIdx, 1);
          ids.splice(toIdx, 0, draggedGroupId);
          reorderGroups(ids);
        }
      }
      return;
    }

    // ── Persona reordering ──
    const personaId = activeIdStr;
    let targetGroupId: string | null;
    if (overId === 'ungrouped') {
      targetGroupId = null;
    } else if (overId.startsWith('group:')) {
      targetGroupId = overId.replace('group:', '');
    } else if (overId.startsWith('group-drag:')) {
      targetGroupId = overId.replace('group-drag:', '');
    } else {
      // Dropped on another persona - find that persona's group
      const targetPersona = personas.find(p => p.id === overId);
      targetGroupId = targetPersona?.group_id || null;
    }

    const currentPersona = personas.find(p => p.id === personaId);
    if (currentPersona && (currentPersona.group_id || null) !== targetGroupId) {
      movePersonaToGroup(personaId, targetGroupId);
    }
  }, [personas, sortedGroups, movePersonaToGroup, reorderGroups]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup({ name: newGroupName.trim(), color: GROUP_COLORS[groups.length % GROUP_COLORS.length] });
    setNewGroupName('');
    setShowNewGroup(false);
  };

  // Droppable for ungrouped section
  const UngroupedZone = () => {
    const { isOver, setNodeRef } = useDroppable({
      id: 'ungrouped',
      data: { type: 'ungrouped' },
    });

    return (
      <div
        ref={setNodeRef}
        className={`rounded-xl border transition-all ${
          isOver && activeId
            ? 'border-primary/30 bg-primary/5'
            : 'border-transparent'
        }`}
      >
        {ungrouped.length > 0 && (
          <div className="px-0.5 py-1">
            <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider px-2 mb-1">
              Ungrouped
            </div>
            {ungrouped.map((persona) => (
              <DraggablePersonaCard
                key={persona.id}
                persona={persona}
                isSelected={selectedPersonaId === persona.id}
                onClick={() => selectPersona(persona.id)}
                onContextMenu={(e) => handleContextMenu(e, persona)}
              />
            ))}
          </div>
        )}
        {ungrouped.length === 0 && groups.length > 0 && activeId && (
          <div className="text-center py-3 text-sm text-muted-foreground/80 border border-dashed border-primary/15 rounded-lg">
            Drop here to ungroup
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* All Agents overview button */}
      <button
        onClick={() => selectPersona(null)}
        className={`w-full flex items-center gap-2.5 px-3 py-2 mb-2 rounded-xl transition-all ${
          selectedPersonaId === null
            ? 'bg-primary/10 border border-primary/20'
            : 'hover:bg-secondary/50 border border-transparent'
        }`}
      >
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-colors ${
          selectedPersonaId === null
            ? 'bg-primary/15 border-primary/25'
            : 'bg-secondary/40 border-primary/15'
        }`}>
          <LayoutGrid className={`w-3.5 h-3.5 ${selectedPersonaId === null ? 'text-primary' : 'text-muted-foreground/90'}`} />
        </div>
        <span className={`text-sm font-medium ${selectedPersonaId === null ? 'text-foreground/90' : 'text-muted-foreground/80'}`}>
          All Agents
        </span>
        <span className="ml-auto text-sm font-mono text-muted-foreground/80">
          {personas.length}
        </span>
      </button>

      {/* Action buttons row */}
      <div className="flex gap-1.5 mb-3">
        <button
          onClick={onCreatePersona}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-primary/30 hover:border-primary/50 bg-primary/5 hover:bg-primary/10 transition-all group"
        >
          <Plus className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-primary/80 group-hover:text-primary">Agent</span>
        </button>
        <button
          onClick={() => { setShowNewGroup(true); setTimeout(() => newGroupInputRef.current?.focus(), 50); }}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-violet-500/30 hover:border-violet-500/50 bg-violet-500/5 hover:bg-violet-500/10 transition-all group"
        >
          <FolderPlus className="w-3.5 h-3.5 text-violet-400 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-violet-400/80 group-hover:text-violet-400">Group</span>
        </button>
      </div>

      {/* New group input */}
      <AnimatePresence>
        {showNewGroup && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mb-2"
          >
            <div className="flex items-center gap-1.5 p-2 rounded-xl border border-violet-500/25 bg-violet-500/5">
              <input
                ref={newGroupInputRef}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup(); if (e.key === 'Escape') setShowNewGroup(false); }}
                placeholder="Group name..."
                className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none text-foreground/90 placeholder:text-muted-foreground/80"
              />
              <button onClick={handleCreateGroup} className="p-1 rounded hover:bg-violet-500/15">
                <Check className="w-3.5 h-3.5 text-violet-400" />
              </button>
              <button onClick={() => setShowNewGroup(false)} className="p-1 rounded hover:bg-secondary/60">
                <X className="w-3.5 h-3.5 text-muted-foreground/90" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DnD Context wrapping groups + ungrouped */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Groups */}
        {sortedGroups.map((group) => (
          <DroppableGroup
            key={group.id}
            group={group}
            personas={grouped.get(group.id) || []}
            selectedPersonaId={selectedPersonaId}
            onSelectPersona={selectPersona}
            onToggleCollapse={() => updateGroup(group.id, { collapsed: !group.collapsed })}
            onRename={(name) => updateGroup(group.id, { name })}
            onDelete={() => deleteGroup(group.id)}
            isDragActive={!!activeId}
            onPersonaContextMenu={handleContextMenu}
          />
        ))}

        {/* Ungrouped */}
        <UngroupedZone />

        {/* Drag overlay */}
        <DragOverlay>
          {activePersona && (
            <div className="opacity-80 pointer-events-none">
              <SidebarPersonaCard persona={activePersona} isSelected={false} onClick={() => {}} />
            </div>
          )}
          {activeGroup && (
            <div className="opacity-80 pointer-events-none rounded-xl border border-primary/20 bg-secondary/40 px-3 py-2 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeGroup.color }} />
              <span className="text-sm font-medium text-foreground/90">{activeGroup.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Empty state */}
      {personas.length === 0 && (
        <div className="text-center py-10 text-sm text-muted-foreground/90">
          No personas yet
        </div>
      )}

      {/* Right-click context menu */}
      <AnimatePresence>
        {contextMenu && (
          <PersonaContextMenu
            state={contextMenu}
            onClose={() => setContextMenu(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
