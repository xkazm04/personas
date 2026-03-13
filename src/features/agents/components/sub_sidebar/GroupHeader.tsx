import { useState, useRef } from 'react';
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
  Settings2,
} from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { PersonaGroup } from '@/lib/types/types';

interface GroupHeaderProps {
  group: PersonaGroup;
  isCollapsed: boolean;
  hasWorkspaceDefaults: boolean;
  personaCount: number;
  dragListeners: DraggableSyntheticListeners;
  dragAttributes: DraggableAttributes;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleSettings: () => void;
}

export function GroupHeader({
  group,
  isCollapsed,
  hasWorkspaceDefaults,
  personaCount,
  dragListeners,
  dragAttributes,
  onToggleCollapse,
  onRename,
  onDelete,
  onToggleSettings,
}: GroupHeaderProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuContainerRef, showMenu, () => setShowMenu(false));

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
    <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer select-none" onClick={onToggleCollapse}>
      <div
        {...dragListeners}
        {...dragAttributes}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
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
            data-testid="group-rename-input"
          />
          <button onClick={handleConfirmRename} className="p-0.5 hover:bg-secondary/60 rounded" data-testid="group-rename-confirm-btn">
            <Check className="w-3 h-3 text-emerald-400" />
          </button>
          <button onClick={() => setIsRenaming(false)} className="p-0.5 hover:bg-secondary/60 rounded" data-testid="group-rename-cancel-btn">
            <X className="w-3 h-3 text-muted-foreground/90" />
          </button>
        </div>
      ) : (
        <span className="text-sm font-medium text-foreground/90 truncate flex-1" title={group.name}>{group.name}</span>
      )}
      {hasWorkspaceDefaults && (
        <Settings2 className="w-3 h-3 text-primary/40 flex-shrink-0" />
      )}
      <span className="text-sm font-mono text-muted-foreground/80">{personaCount}</span>
      <div className="relative" ref={menuContainerRef} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="p-0.5 rounded hover:bg-secondary/60 text-muted-foreground/80 hover:text-muted-foreground transition-colors"
          data-testid="group-menu-btn"
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
              className="absolute right-0 top-6 z-50 w-32 py-1 bg-background border border-primary/20 rounded-lg shadow-lg origin-top-right"
            >
              <button onClick={handleStartRename} className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90" data-testid="group-rename-btn">
                <Pencil className="w-3 h-3" /> Rename
              </button>
              <button onClick={() => { onToggleSettings(); setShowMenu(false); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/60 flex items-center gap-2 text-foreground/90" data-testid="group-settings-btn">
                <Settings2 className="w-3 h-3" /> Settings
              </button>
              <button onClick={() => { onDelete(); setShowMenu(false); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-red-500/10 flex items-center gap-2 text-red-400" data-testid="group-delete-btn">
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
  );
}
