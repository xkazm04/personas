import { useState, useRef, useCallback } from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  GripVertical,
  Pencil,
  Trash2,
  X,
  Check,
} from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/useClickOutside';
import { DraggablePersonaCard } from './DraggablePersonaCard';
import type { DbPersona, DbPersonaGroup } from '@/lib/types/types';

interface DroppableGroupProps {
  group: DbPersonaGroup;
  personas: DbPersona[];
  selectedPersonaId: string | null;
  onSelectPersona: (id: string) => void;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  isDragActive: boolean;
  onPersonaContextMenu?: (e: React.MouseEvent, persona: DbPersona) => void;
}

export function DroppableGroup({
  group,
  personas,
  selectedPersonaId,
  onSelectPersona,
  onToggleCollapse,
  onRename,
  onDelete,
  isDragActive,
  onPersonaContextMenu,
}: DroppableGroupProps) {
  const { isOver, setNodeRef: setDropRef } = useDroppable({
    id: `group:${group.id}`,
    data: { type: 'group', groupId: group.id },
  });
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `group-drag:${group.id}`,
    data: { type: 'group-reorder', groupId: group.id },
  });
  const setNodeRef = useCallback((node: HTMLElement | null) => {
    setDropRef(node);
    setDragRef(node);
  }, [setDropRef, setDragRef]);
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : undefined;

  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuContainerRef, showMenu, () => setShowMenu(false));

  const isCollapsed = group.collapsed;

  const handleStartRename = () => {
    setRenameValue(group.name);
    setIsRenaming(true);
    setShowMenu(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleConfirmRename = () => {
    if (renameValue.trim() && renameValue.trim() !== group.name) {
      onRename(renameValue.trim());
    }
    setIsRenaming(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border transition-all mb-2 ${isDragging ? 'opacity-30' : ''} ${
        isOver && isDragActive
          ? 'border-primary/40 bg-primary/5 shadow-[0_0_12px_rgba(59,130,246,0.1)]'
          : 'border-primary/10 bg-secondary/20'
      }`}
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none" onClick={onToggleCollapse}>
        <div
          {...listeners}
          {...attributes}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 text-muted-foreground/80 hover:text-muted-foreground transition-colors"
        >
          <GripVertical className="w-3 h-3" />
        </div>
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
        {isRenaming ? (
          <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmRename(); if (e.key === 'Escape') setIsRenaming(false); }}
              className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b border-primary/40 outline-none text-foreground/90 py-0.5"
            />
            <button onClick={handleConfirmRename} className="p-0.5 hover:bg-secondary/60 rounded">
              <Check className="w-3 h-3 text-emerald-400" />
            </button>
            <button onClick={() => setIsRenaming(false)} className="p-0.5 hover:bg-secondary/60 rounded">
              <X className="w-3 h-3 text-muted-foreground/90" />
            </button>
          </div>
        ) : (
          <span className="text-sm font-medium text-foreground/90 truncate flex-1">{group.name}</span>
        )}
        <span className="text-sm font-mono text-muted-foreground/80">{personas.length}</span>
        <div className="relative" ref={menuContainerRef} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-0.5 rounded hover:bg-secondary/60 text-muted-foreground/80 hover:text-muted-foreground transition-colors"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-6 z-50 w-28 py-1 bg-background border border-primary/20 rounded-lg shadow-lg origin-top-right"
              >
                <button
                  onClick={handleStartRename}
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90"
                >
                  <Pencil className="w-3 h-3" /> Rename
                </button>
                <button
                  onClick={() => { onDelete(); setShowMenu(false); }}
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-red-500/10 flex items-center gap-2 text-red-400"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {isCollapsed ? (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
        )}
      </div>

      {/* Persona list (collapsible) */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-1.5 pb-1.5">
              {personas.length === 0 && (
                <div className="text-center py-3 text-sm text-muted-foreground/80">
                  Drop agents here
                </div>
              )}
              {personas.map((persona) => (
                <DraggablePersonaCard
                  key={persona.id}
                  persona={persona}
                  isSelected={selectedPersonaId === persona.id}
                  onClick={() => onSelectPersona(persona.id)}
                  onContextMenu={onPersonaContextMenu ? (e) => onPersonaContextMenu(e, persona) : undefined}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
