import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, LayoutGrid, FolderPlus, X, Check } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { SearchFilterBar } from '@/features/agents/components/sub_sidebar/components/SearchFilterBar';
import type { usePersonaFilters } from '@/features/agents/components/sub_sidebar/libs/usePersonaFilters';
import { GROUP_COLORS } from './sidebarDragHelpers';

interface SidebarHeaderProps {
  onCreatePersona: () => void;
  filters: ReturnType<typeof usePersonaFilters>['filters'];
  hasActiveFilters: boolean;
  filteredCount: number;
  totalCount: number;
  allAutoTags: ReturnType<typeof usePersonaFilters>['allAutoTags'];
  onSearchChange: (value: string) => void;
  onToggleTag: (tag: string) => void;
  onClearFilters: () => void;
}

export function SidebarHeader({
  onCreatePersona,
  filters,
  hasActiveFilters,
  filteredCount,
  totalCount,
  allAutoTags,
  onSearchChange,
  onToggleTag,
  onClearFilters,
}: SidebarHeaderProps) {
  const selectedPersonaId = usePersonaStore((s) => s.selectedPersonaId);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const groups = usePersonaStore((s) => s.groups);
  const createGroup = usePersonaStore((s) => s.createGroup);

  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const newGroupInputRef = useRef<HTMLInputElement>(null);

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
          {totalCount}
        </span>
      </button>

      {/* Search & Filter Bar */}
      <SearchFilterBar
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        matchCount={filteredCount}
        totalCount={totalCount}
        allAutoTags={allAutoTags}
        onSearchChange={onSearchChange}
        onToggleTag={onToggleTag}
        onClear={onClearFilters}
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
    </>
  );
}
