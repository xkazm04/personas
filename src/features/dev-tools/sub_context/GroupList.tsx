import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, ChevronDown, ChevronRight, X, FolderTree } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import type { ContextGroup } from './contextMapTypes';
import { colorDot } from './GroupColorPicker';
import GroupColorPicker from './GroupColorPicker';
import ContextCard from './ContextCard';

interface GroupListProps {
  groups: ContextGroup[];
  selectedCtxId: string | null;
  onSelectCtx: (id: string | null) => void;
  showNewGroup: boolean;
  onShowNewGroup: (v: boolean) => void;
  onCreateGroup: (name: string, color: string) => void;
  onScan: () => void;
}

export default function GroupList({
  groups, selectedCtxId, onSelectCtx,
  showNewGroup, onShowNewGroup, onCreateGroup, onScan,
}: GroupListProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('amber');
  const { staggerDelay } = useMotion();

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (!newGroupName.trim()) return;
    onCreateGroup(newGroupName.trim(), newGroupColor);
    setNewGroupName('');
    onShowNewGroup(false);
  };

  const totalContexts = groups.reduce((acc, g) => acc + g.contexts.length, 0);

  return (
    <div className="flex-1 min-w-0 space-y-3">
      <AnimatePresence>
        {showNewGroup && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="border border-primary/10 rounded-xl p-4 bg-primary/5 space-y-3">
              <div className="flex items-center gap-2">
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} placeholder="Group name..." className="flex-1 px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/40 focus-ring" autoFocus />
                <Button variant="accent" accentColor="amber" size="sm" disabled={!newGroupName.trim()} disabledReason="Enter a group name to create" onClick={handleCreate}>Create</Button>
                <Button variant="ghost" size="icon-sm" onClick={() => onShowNewGroup(false)}><X className="w-3.5 h-3.5" /></Button>
              </div>
              <GroupColorPicker selectedColor={newGroupColor} onChange={setNewGroupColor} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {groups.length === 0 && !showNewGroup ? (
        <div className="text-center py-20">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
            <FolderTree className="w-7 h-7 text-amber-400/50" />
          </div>
          <p className="text-sm text-muted-foreground/60 mb-1">No context groups yet</p>
          <p className="text-xs text-muted-foreground/40 mb-4">Scan your codebase or create groups manually</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => onShowNewGroup(true)}>Add Group</Button>
            <Button variant="accent" accentColor="amber" size="sm" icon={<Search className="w-3.5 h-3.5" />} onClick={onScan}>Scan Codebase</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group, gi) => {
            const isExpanded = expandedGroups.has(group.id);
            const dot = colorDot(group.color);
            return (
              <motion.div key={group.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: gi * staggerDelay }} className="border border-primary/10 rounded-xl overflow-hidden">
                <button onClick={() => toggleGroup(group.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors">
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />}
                  <span className={`w-2.5 h-2.5 rounded-full ${dot.bg} flex-shrink-0`} />
                  <span className="text-sm font-medium text-foreground/80 flex-1 text-left">{group.name}</span>
                  <span className="text-[10px] text-muted-foreground/50 bg-primary/5 rounded-full px-2 py-0.5">{group.contexts.length} context{group.contexts.length !== 1 ? 's' : ''}</span>
                </button>
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <div className="px-4 pb-4 pt-1">
                        {group.contexts.length === 0 ? (
                          <p className="text-xs text-muted-foreground/40 py-3 text-center">No contexts in this group yet</p>
                        ) : (
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            {group.contexts.map((ctx) => (
                              <ContextCard key={ctx.id} ctx={ctx} selected={selectedCtxId === ctx.id} onSelect={() => onSelectCtx(selectedCtxId === ctx.id ? null : ctx.id)} />
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {groups.length > 0 && (
        <div className="flex items-center gap-4 pt-3 border-t border-primary/5 text-xs text-muted-foreground/50">
          <span>{groups.length} group{groups.length !== 1 ? 's' : ''}</span>
          <span>{totalContexts} context{totalContexts !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
