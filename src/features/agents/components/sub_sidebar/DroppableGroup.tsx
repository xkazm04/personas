import { useState, useCallback } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import { DraggablePersonaCard } from './DraggablePersonaCard';
import { WorkspaceSettings } from './WorkspaceSettings';
import { GroupHeader } from './GroupHeader';
import type { DbPersona, DbPersonaGroup } from '@/lib/types/types';
import type { DragPayload, DropPayload } from '@/lib/types/frontendTypes';

interface DroppableGroupProps {
  group: DbPersonaGroup;
  personas: DbPersona[];
  selectedPersonaId: string | null;
  onSelectPersona: (id: string) => void;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onUpdateWorkspace?: (updates: Partial<{
    description: string;
    defaultModelProfile: string;
    defaultMaxBudgetUsd: number;
    defaultMaxTurns: number;
    sharedInstructions: string;
  }>) => void;
  isDragActive: boolean;
  onPersonaContextMenu?: (e: React.MouseEvent, persona: DbPersona) => void;
}

export function DroppableGroup({
  group, personas, selectedPersonaId, onSelectPersona, onToggleCollapse,
  onRename, onDelete, onUpdateWorkspace, isDragActive, onPersonaContextMenu,
}: DroppableGroupProps) {
  const dropData: DropPayload = { type: 'group', groupId: group.id };
  const { isOver, setNodeRef: setDropRef } = useDroppable({ id: `group:${group.id}`, data: dropData });
  const dragData: DragPayload = { type: 'group-reorder', groupId: group.id };
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: `group-drag:${group.id}`, data: dragData });
  const setNodeRef = useCallback((node: HTMLElement | null) => { setDropRef(node); setDragRef(node); }, [setDropRef, setDragRef]);
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;

  const [showSettings, setShowSettings] = useState(false);
  const isCollapsed = group.collapsed;
  const hasWorkspaceDefaults = !!(group.defaultModelProfile || group.defaultMaxBudgetUsd || group.defaultMaxTurns || group.sharedInstructions);

  return (
    <motion.div
      ref={setNodeRef} style={style}
      className={`rounded-xl border transition-all mb-2 ${isDragging ? 'opacity-30' : ''} ${
        isOver && isDragActive ? 'border-primary/40 bg-primary/5 shadow-[0_0_12px_rgba(139,92,246,0.15)]' : 'border-primary/10 bg-secondary/20'
      }`}
      animate={isOver && isDragActive ? { scale: 1.01, boxShadow: '0 0 12px rgba(139,92,246,0.15)' } : { scale: 1, boxShadow: '0 0 0 rgba(0,0,0,0)' }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, duration: 0.15 }}
    >
      <GroupHeader
        group={group}
        isCollapsed={isCollapsed}
        hasWorkspaceDefaults={hasWorkspaceDefaults}
        personaCount={personas.length}
        dragListeners={listeners}
        dragAttributes={attributes}
        onToggleCollapse={onToggleCollapse}
        onRename={onRename}
        onDelete={onDelete}
        onToggleSettings={() => setShowSettings(!showSettings)}
      />

      <AnimatePresence initial={false}>
        {showSettings && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <WorkspaceSettings group={group} onUpdate={onUpdateWorkspace ?? (() => {})} onClose={() => setShowSettings(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-1.5 pb-1.5">
              {personas.length === 0 && <div className="text-center py-3 text-sm text-muted-foreground/80">Drop agents here</div>}
              {personas.map((persona) => (
                <DraggablePersonaCard
                  key={persona.id} persona={persona} isSelected={selectedPersonaId === persona.id}
                  onClick={() => onSelectPersona(persona.id)}
                  onContextMenu={onPersonaContextMenu ? (e) => onPersonaContextMenu(e, persona) : undefined}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
