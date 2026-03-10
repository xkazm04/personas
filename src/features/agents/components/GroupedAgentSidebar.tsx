import { useState, useMemo, useCallback, useRef } from 'react';
import { DndContext, DragOverlay, closestCenter, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, LayoutGrid, FolderPlus, X, Check } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { SidebarPersonaCard } from '@/features/agents/components/sub_sidebar/components/DraggablePersonaCard';
import { DroppableGroup } from '@/features/agents/components/sub_sidebar/components/DroppableGroup';
import { UngroupedZone } from '@/features/agents/components/sub_sidebar/components/UngroupedZone';
import { PersonaContextMenu, type ContextMenuState } from '@/features/agents/components/sub_sidebar/components/PersonaContextMenu';
import { SearchFilterBar } from '@/features/agents/components/sub_sidebar/components/SearchFilterBar';
import { usePersonaFilters } from '@/features/agents/components/sub_sidebar/libs/usePersonaFilters';
import { buildSidebarTree, type DragPayload, type DropPayload } from '@/lib/types/frontendTypes';
import type { DbPersona } from '@/lib/types/types';

// â”€â”€ Color palette for groups â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GROUP_COLORS = [
  '#6B7280', '#3B82F6', '#8B5CF6', '#EC4899', '#EF4444',
  '#F59E0B', '#10B981', '#06B6D4', '#6366F1', '#F97316',
];

// â”€â”€ Drag payload helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getDragPayload(event: { active: { data: { current?: Record<string, unknown> } } }): DragPayload | null {
  return (event.active.data.current as DragPayload) ?? null;
}

function getDropPayload(event: { over: { data: { current?: Record<string, unknown> } } | null }): DropPayload | null {
  if (!event.over) return null;
  return (event.over.data.current as DropPayload) ?? null;
}

/** Resolve a drop payload to a target group ID (or null for ungrouped). */
function resolveDropGroupId(drop: DropPayload, personas: DbPersona[]): string | null {
  switch (drop.type) {
    case 'group': return drop.groupId;
    case 'group-reorder': return drop.groupId;
    case 'ungrouped': return null;
    case 'persona': {
      const target = personas.find(p => p.id === drop.personaId);
      return target?.group_id || null;
    }
  }
}

// â”€â”€ Main GroupedAgentSidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  const personaHealthMap = usePersonaStore((s) => s.personaHealthMap);
  const personaLastRun = usePersonaStore((s) => s.personaLastRun);

  // Search / Filter / Smart Tags
  const {
    filters,
    setSearch,
    toggleTag,
    clearFilters,
    hasActiveFilters,
    filteredIds,
    allAutoTags,
  } = usePersonaFilters(personas, personaHealthMap, personaLastRun);

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
  const dragStartGroupIdsRef = useRef<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Build tree once from flat arrays, then filter by search/filter results
  const tree = useMemo(() => buildSidebarTree(groups, personas), [groups, personas]);

  // Apply filters to tree nodes
  const filteredTree = useMemo(() => {
    if (!hasActiveFilters) return tree;
    return tree.map((node) => ({
      ...node,
      children: node.children.filter((p) => filteredIds.has(p.id)),
    }));
  }, [tree, filteredIds, hasActiveFilters]);

  const groupNodes = filteredTree.filter((n) => n.kind === 'group');
  const ungroupedNode = filteredTree.find((n) => n.kind === 'ungrouped');
  const ungrouped = ungroupedNode?.children ?? [];

  // Hide empty groups when filtering
  const visibleGroupNodes = hasActiveFilters
    ? groupNodes.filter((n) => n.kind === 'group' && n.children.length > 0)
    : groupNodes;

  // Sorted group list for reorder operations
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [groups]);

  // Resolve active drag overlay
  const activeDragRef = useRef<DragPayload | null>(null);
  const activeDrag = activeDragRef.current;
  const activePersona = activeDrag?.type === 'persona'
    ? personas.find(p => p.id === activeDrag.personaId)
    : null;
  const activeGroup = activeDrag?.type === 'group-reorder'
    ? sortedGroups.find(g => g.id === activeDrag.groupId)
    : null;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    dragStartGroupIdsRef.current = sortedGroups.map(g => g.id);
    const payload = getDragPayload(event);
    activeDragRef.current = payload;
    setActiveId(String(event.active.id));
  }, [sortedGroups]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    activeDragRef.current = null;
    setActiveId(null);

    const drag = getDragPayload(event);
    const drop = getDropPayload(event);
    if (!drag || !drop) return;

    // â”€â”€ Group reordering â”€â”€
    if (drag.type === 'group-reorder') {
      const draggedGroupId = drag.groupId;
      const targetGroupId = (drop.type === 'group' || drop.type === 'group-reorder')
        ? drop.groupId
        : null;

      if (targetGroupId && draggedGroupId !== targetGroupId) {
        const ids = [...dragStartGroupIdsRef.current];
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

    // â”€â”€ Persona reordering â”€â”€
    const personaId = drag.personaId;
    const targetGroupId = resolveDropGroupId(drop, personas);

    const currentPersona = personas.find(p => p.id === personaId);
    if (currentPersona && (currentPersona.group_id || null) !== targetGroupId) {
      movePersonaToGroup(personaId, targetGroupId);
    }
  }, [personas, movePersonaToGroup, reorderGroups]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup({ name: newGroupName.trim(), color: GROUP_COLORS[groups.length % GROUP_COLORS.length] });
    setNewGroupName('');
    setShowNewGroup(false);
  };

  return (
    <>
      {/* All Agents overview button */}
      <button
        onClick={() => selectPersona(null)}
        data-testid="sidebar-all-agents-btn"
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

      {/* Search & Filter Bar */}
      <SearchFilterBar
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        matchCount={filteredIds.size}
        totalCount={personas.length}
        allAutoTags={allAutoTags}
        onSearchChange={setSearch}
        onToggleTag={toggleTag}
        onClear={clearFilters}
      />

      {/* Action buttons row */}
      <div className="flex gap-1.5 mb-3">
        <button
          onClick={onCreatePersona}
          data-testid="sidebar-create-agent-btn"
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-primary/30 hover:border-primary/50 bg-primary/5 hover:bg-primary/10 transition-all group"
        >
          <Plus className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
          <span className="text-sm font-medium text-primary/80 group-hover:text-primary">Agent</span>
        </button>
        <button
          onClick={() => { setShowNewGroup(true); setTimeout(() => newGroupInputRef.current?.focus(), 50); }}
          data-testid="sidebar-create-group-btn"
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
                data-testid="sidebar-new-group-input"
                className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none text-foreground/90 placeholder:text-muted-foreground/80"
              />
              <button onClick={handleCreateGroup} data-testid="sidebar-confirm-group-btn" className="p-1 rounded hover:bg-violet-500/15">
                <Check className="w-3.5 h-3.5 text-violet-400" />
              </button>
              <button onClick={() => setShowNewGroup(false)} data-testid="sidebar-cancel-group-btn" className="p-1 rounded hover:bg-secondary/60">
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
        {/* Groups â€” iterate filtered tree nodes */}
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

        {/* Ungrouped */}
        <UngroupedZone
          ungrouped={ungrouped}
          groupsLength={groups.length}
          activeId={activeId}
          selectedPersonaId={selectedPersonaId}
          selectPersona={selectPersona}
          handleContextMenu={handleContextMenu}
        />

        {/* Drag overlay */}
        <DragOverlay>
          {activePersona && (
            <motion.div
              className="opacity-85 pointer-events-none"
              initial={{ rotate: 0, scale: 1 }}
              animate={{ rotate: 2, scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            >
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

      {/* Empty state when filtering */}
      {hasActiveFilters && filteredIds.size === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground/70">
          <p>No agents match your filters</p>
          <button
            onClick={clearFilters}
            className="mt-2 text-sm text-primary/70 hover:text-primary transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}

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
