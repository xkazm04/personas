import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Map, Plus, Search, ChevronDown, ChevronRight, File, Tag,
  ArrowUpRight, X, Loader2, FolderTree,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useDevToolsActions } from '../hooks/useDevToolsActions';

// ---------------------------------------------------------------------------
// Types (local until devToolsSlice is wired)
// ---------------------------------------------------------------------------

interface ContextGroup {
  id: string;
  name: string;
  color: string;
  contexts: ContextItem[];
}

interface ContextItem {
  id: string;
  groupId: string;
  name: string;
  description: string;
  filePaths: string[];
  keywords: string[];
  entryPoints: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  { id: 'red', bg: 'bg-red-400', ring: 'ring-red-400/30' },
  { id: 'orange', bg: 'bg-orange-400', ring: 'ring-orange-400/30' },
  { id: 'amber', bg: 'bg-amber-400', ring: 'ring-amber-400/30' },
  { id: 'emerald', bg: 'bg-emerald-400', ring: 'ring-emerald-400/30' },
  { id: 'blue', bg: 'bg-blue-400', ring: 'ring-blue-400/30' },
  { id: 'indigo', bg: 'bg-indigo-400', ring: 'ring-indigo-400/30' },
  { id: 'violet', bg: 'bg-violet-400', ring: 'ring-violet-400/30' },
  { id: 'pink', bg: 'bg-pink-400', ring: 'ring-pink-400/30' },
];

function colorDot(colorId: string) {
  return COLOR_PALETTE.find((p) => p.id === colorId) ?? COLOR_PALETTE[0]!;
}

// ---------------------------------------------------------------------------
// Scan Overlay
// ---------------------------------------------------------------------------

function ScanOverlay({ scanning, progress }: { scanning: boolean; progress: number }) {
  if (!scanning) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="bg-background border border-primary/10 rounded-2xl p-8 w-full max-w-sm text-center shadow-2xl">
        <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
          <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
        </div>
        <h3 className="text-base font-semibold text-foreground/90 mb-2">Scanning Codebase</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Analyzing file structure, imports, and patterns...
        </p>
        <div className="w-full h-2 bg-primary/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-amber-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-2">{Math.round(progress)}% complete</p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Context Card
// ---------------------------------------------------------------------------

function ContextCard({
  ctx,
  selected,
  onSelect,
}: {
  ctx: ContextItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.div
      layout
      onClick={onSelect}
      className={`border rounded-xl p-4 cursor-pointer transition-colors ${
        selected
          ? 'bg-primary/10 border-primary/20'
          : 'border-primary/10 hover:bg-primary/5 hover:border-primary/20'
      }`}
    >
      <h4 className="text-sm font-medium text-foreground/80 mb-1">{ctx.name}</h4>
      <p className="text-xs text-muted-foreground/60 line-clamp-2 mb-3">{ctx.description}</p>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 bg-primary/5 rounded-full px-2 py-0.5">
          <File className="w-3 h-3" />
          {ctx.filePaths.length} files
        </span>
        {ctx.keywords.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 bg-primary/5 rounded-full px-2 py-0.5">
            <Tag className="w-3 h-3" />
            {ctx.keywords.length}
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Context Detail Panel
// ---------------------------------------------------------------------------

function ContextDetail({ ctx, onClose }: { ctx: ContextItem; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      className="w-80 flex-shrink-0 border-l border-primary/10 pl-5 overflow-y-auto"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground/80">{ctx.name}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground/70 mb-4">{ctx.description}</p>

      {/* File paths */}
      <div className="mb-4">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">
          Files ({ctx.filePaths.length})
        </h4>
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {ctx.filePaths.map((fp) => (
            <div key={fp} className="flex items-center gap-1.5 text-xs text-muted-foreground/60 py-0.5">
              <File className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{fp}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Keywords */}
      {ctx.keywords.length > 0 && (
        <div className="mb-4">
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">Keywords</h4>
          <div className="flex flex-wrap gap-1.5">
            {ctx.keywords.map((kw) => (
              <span key={kw} className="px-2 py-0.5 text-[10px] bg-primary/5 border border-primary/10 rounded-full text-muted-foreground/60">
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Entry points */}
      {ctx.entryPoints.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-2">Entry Points</h4>
          <div className="space-y-1">
            {ctx.entryPoints.map((ep) => (
              <div key={ep} className="flex items-center gap-1.5 text-xs text-muted-foreground/60 py-0.5">
                <ArrowUpRight className="w-3 h-3 flex-shrink-0 text-amber-400/60" />
                <span className="truncate">{ep}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Group Color Picker
// ---------------------------------------------------------------------------

function GroupColorPicker({
  selectedColor,
  onChange,
}: {
  selectedColor: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {COLOR_PALETTE.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`w-5 h-5 rounded-full ${c.bg} transition-all ${
            selectedColor === c.id ? `ring-2 ${c.ring} scale-110` : 'opacity-60 hover:opacity-100'
          }`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ContextMapPage() {
  const { fetchContextMap, createContextGroup, scanCodebase } = useDevToolsActions();

  const [groups, _setGroups] = useState<ContextGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedCtxId, setSelectedCtxId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('amber');
  const { staggerDelay } = useMotion();

  useEffect(() => {
    fetchContextMap();
  }, []);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanProgress(0);
    // Simulate progress (will be replaced by real backend events)
    const interval = setInterval(() => {
      setScanProgress((p) => {
        if (p >= 95) { clearInterval(interval); return 95; }
        return p + Math.random() * 12;
      });
    }, 400);
    try {
      await scanCodebase();
    } finally {
      clearInterval(interval);
      setScanProgress(100);
      setTimeout(() => { setScanning(false); setScanProgress(0); }, 600);
    }
  }, [scanCodebase]);

  const handleCreateGroup = () => {
    if (!newGroupName.trim()) return;
    createContextGroup({ name: newGroupName.trim(), color: newGroupColor });
    setNewGroupName('');
    setShowNewGroup(false);
  };

  // Find selected context across all groups
  const selectedCtx = groups
    .flatMap((g) => g.contexts)
    .find((c) => c.id === selectedCtxId);

  const totalContexts = groups.reduce((acc, g) => acc + g.contexts.length, 0);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Map className="w-5 h-5 text-amber-400" />}
        iconColor="amber"
        title="Context Map"
        subtitle="Scan codebases into business-feature contexts"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowNewGroup(true)}
            >
              Group
            </Button>
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              icon={<Search className="w-3.5 h-3.5" />}
              loading={scanning}
              onClick={handleScan}
            >
              Scan Codebase
            </Button>
          </div>
        }
      />

      <ContentBody>
        <div className="flex gap-0 min-h-0 flex-1">
          {/* Group list */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* New group form */}
            <AnimatePresence>
              {showNewGroup && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="border border-primary/10 rounded-xl p-4 bg-primary/5 space-y-3">
                    <div className="flex items-center gap-2">
                      <input
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                        placeholder="Group name..."
                        className="flex-1 px-3 py-2 text-sm bg-secondary/40 border border-primary/10 rounded-xl text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
                        autoFocus
                      />
                      <Button variant="accent" accentColor="amber" size="sm" disabled={!newGroupName.trim()} disabledReason="Enter a group name to create" onClick={handleCreateGroup}>
                        Create
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setShowNewGroup(false)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <GroupColorPicker selectedColor={newGroupColor} onChange={setNewGroupColor} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Empty state */}
            {groups.length === 0 && !showNewGroup ? (
              <div className="text-center py-20">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <FolderTree className="w-7 h-7 text-amber-400/50" />
                </div>
                <p className="text-sm text-muted-foreground/60 mb-1">No context groups yet</p>
                <p className="text-xs text-muted-foreground/40 mb-4">
                  Scan your codebase or create groups manually
                </p>
                <div className="flex justify-center gap-2">
                  <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowNewGroup(true)}>
                    Add Group
                  </Button>
                  <Button variant="accent" accentColor="amber" size="sm" icon={<Search className="w-3.5 h-3.5" />} onClick={handleScan}>
                    Scan Codebase
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {groups.map((group, gi) => {
                  const isExpanded = expandedGroups.has(group.id);
                  const dot = colorDot(group.color);
                  return (
                    <motion.div
                      key={group.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: gi * staggerDelay }}
                      className="border border-primary/10 rounded-xl overflow-hidden"
                    >
                      {/* Group header */}
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/5 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                        )}
                        <span className={`w-2.5 h-2.5 rounded-full ${dot.bg} flex-shrink-0`} />
                        <span className="text-sm font-medium text-foreground/80 flex-1 text-left">
                          {group.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50 bg-primary/5 rounded-full px-2 py-0.5">
                          {group.contexts.length} context{group.contexts.length !== 1 ? 's' : ''}
                        </span>
                      </button>

                      {/* Expanded contexts grid */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="px-4 pb-4 pt-1">
                              {group.contexts.length === 0 ? (
                                <p className="text-xs text-muted-foreground/40 py-3 text-center">
                                  No contexts in this group yet
                                </p>
                              ) : (
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                                  {group.contexts.map((ctx) => (
                                    <ContextCard
                                      key={ctx.id}
                                      ctx={ctx}
                                      selected={selectedCtxId === ctx.id}
                                      onSelect={() => setSelectedCtxId(selectedCtxId === ctx.id ? null : ctx.id)}
                                    />
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

            {/* Summary footer */}
            {groups.length > 0 && (
              <div className="flex items-center gap-4 pt-3 border-t border-primary/5 text-xs text-muted-foreground/50">
                <span>{groups.length} group{groups.length !== 1 ? 's' : ''}</span>
                <span>{totalContexts} context{totalContexts !== 1 ? 's' : ''}</span>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <AnimatePresence>
            {selectedCtx && (
              <ContextDetail ctx={selectedCtx} onClose={() => setSelectedCtxId(null)} />
            )}
          </AnimatePresence>
        </div>
      </ContentBody>

      <AnimatePresence>
        <ScanOverlay scanning={scanning} progress={scanProgress} />
      </AnimatePresence>
    </ContentBox>
  );
}
