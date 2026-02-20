import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Check, CheckCircle, AlertCircle, ArrowRight, Undo2, Search, BarChart3, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getConnectorMeta } from '@/lib/utils/connector-meta';

export function ToolSelector() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const toolDefinitions = usePersonaStore((state) => state.toolDefinitions);
  const credentials = usePersonaStore((state) => state.credentials);
  const assignTool = usePersonaStore((state) => state.assignTool);
  const removeTool = usePersonaStore((state) => state.removeTool);
  const setSidebarSection = usePersonaStore((state) => state.setSidebarSection);
  const setCredentialView = usePersonaStore((state) => state.setCredentialView);
  const toolUsageSummary = usePersonaStore((state) => state.toolUsageSummary);
  const fetchToolUsage = usePersonaStore((state) => state.fetchToolUsage);
  const connectorDefinitions = usePersonaStore((state) => state.connectorDefinitions);

  // Build a lookup from service_type/name → friendly label
  const credentialLabel = useCallback((credType: string): string => {
    // First try connector definitions from the store (most accurate)
    const connector = connectorDefinitions.find((c) => c.name === credType);
    if (connector) return connector.label;
    // Fall back to static connector meta
    return getConnectorMeta(credType).label;
  }, [connectorDefinitions]);

  const credentialTypeSet = useMemo(() => {
    const set = new Set<string>();
    credentials.forEach(c => set.add(c.service_type));
    return set;
  }, [credentials]);

  useEffect(() => {
    fetchToolUsage(30);
  }, [fetchToolUsage]);

  const usageByTool = useMemo(() => {
    const map = new Map<string, number>();
    toolUsageSummary.forEach((s) => map.set(s.tool_name, s.total_invocations));
    return map;
  }, [toolUsageSummary]);

  const personaId = selectedPersona?.id || '';
  const assignedToolIds = selectedPersona?.tools?.map(t => t.id) || [];

  // Map assigned tool IDs to their definitions for name lookup
  const assignedTools = useMemo(() => {
    const toolIdSet = new Set(assignedToolIds);
    return toolDefinitions.filter((td) => toolIdSet.has(td.id));
  }, [assignedToolIds, toolDefinitions]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    toolDefinitions.forEach((tool) => {
      if (tool.category) cats.add(tool.category);
    });
    return ['All', ...Array.from(cats)];
  }, [toolDefinitions]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set('All', toolDefinitions.length);
    for (const tool of toolDefinitions) {
      if (tool.category) {
        counts.set(tool.category, (counts.get(tool.category) || 0) + 1);
      }
    }
    return counts;
  }, [toolDefinitions]);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [justToggledId, setJustToggledId] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ toolId: string; toolName: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSearching = searchQuery.trim().length > 0;

  const filteredTools = useMemo(() => {
    let tools = toolDefinitions;
    if (!isSearching && selectedCategory !== 'All') {
      tools = tools.filter((tool) => tool.category === selectedCategory);
    }
    if (isSearching) {
      const q = searchQuery.trim().toLowerCase();
      tools = tools.filter((tool) =>
        tool.name.toLowerCase().includes(q) ||
        (tool.description && tool.description.toLowerCase().includes(q))
      );
    }
    return tools;
  }, [toolDefinitions, selectedCategory, searchQuery, isSearching]);

  const clearUndoToast = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast(null);
  }, []);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/40">
        No persona selected
      </div>
    );
  }

  const handleToggleTool = async (toolId: string, toolName: string, isAssigned: boolean) => {
    clearUndoToast();
    if (isAssigned) {
      await removeTool(personaId, toolId);
      setUndoToast({ toolId, toolName });
      undoTimerRef.current = setTimeout(() => setUndoToast(null), 5000);
    } else {
      await assignTool(personaId, toolId);
    }
    setJustToggledId(toolId);
    setTimeout(() => setJustToggledId(null), 600);
  };

  const handleUndo = async () => {
    if (!undoToast) return;
    await assignTool(personaId, undoToast.toolId);
    setJustToggledId(undoToast.toolId);
    setTimeout(() => setJustToggledId(null), 600);
    clearUndoToast();
  };

  const handleClearAll = async () => {
    clearUndoToast();
    for (const tool of assignedTools) {
      await removeTool(personaId, tool.id);
    }
  };

  return (
    <div className="space-y-5">
      {/* Search Input */}
      <div className="relative max-w-[280px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tools..."
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Category Filter */}
      <div className={`flex items-center gap-2 flex-wrap transition-opacity ${isSearching ? 'opacity-40 pointer-events-none' : ''}`}>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => { setSelectedCategory(category); setSearchQuery(''); }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all ${
              selectedCategory === category
                ? 'bg-primary text-foreground shadow-lg shadow-primary/20'
                : 'bg-secondary/40 text-muted-foreground/60 hover:bg-secondary/60 hover:text-foreground/80 border border-primary/15'
            }`}
          >
            {category}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              selectedCategory === category
                ? 'bg-primary/20 text-foreground/80'
                : 'bg-muted/30 text-muted-foreground/40'
            }`}>
              {categoryCounts.get(category) ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Assigned tools summary bar */}
      {assignedTools.length > 0 && (
        <div className="flex items-center gap-2 bg-primary/5 border border-primary/10 rounded-xl px-4 py-2">
          <span className="text-xs text-muted-foreground/60 flex-shrink-0">
            <span className="font-semibold text-foreground/70">{assignedTools.length}</span> of {toolDefinitions.length} tools assigned
          </span>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden ml-2">
            {assignedTools.slice(0, 5).map((tool) => (
              <span
                key={tool.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-primary/10 text-foreground/70 border border-primary/15 truncate max-w-[120px] flex-shrink-0"
              >
                {tool.name}
              </span>
            ))}
            {assignedTools.length > 5 && (
              <span className="text-[11px] text-muted-foreground/40 flex-shrink-0">
                +{assignedTools.length - 5} more
              </span>
            )}
          </div>
          <button
            onClick={handleClearAll}
            className="flex-shrink-0 text-[11px] text-muted-foreground/50 hover:text-red-400 transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" />
            Clear all
          </button>
        </div>
      )}

      {/* Tools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {filteredTools.map((tool) => {
          const isAssigned = assignedToolIds.includes(tool.id);
          const missingCredential = tool.requires_credential_type && !credentialTypeSet.has(tool.requires_credential_type);
          return (
            <motion.div
              key={tool.id}
              role="checkbox"
              aria-checked={isAssigned}
              aria-label={tool.name}
              aria-disabled={missingCredential ? true : undefined}
              tabIndex={0}
              whileHover={missingCredential ? undefined : { scale: 1.02 }}
              whileTap={missingCredential ? undefined : { scale: 0.98 }}
              onClick={() => !missingCredential && handleToggleTool(tool.id, tool.name, isAssigned)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if ((e.key === ' ' || e.key === 'Enter') && !missingCredential) {
                  e.preventDefault();
                  handleToggleTool(tool.id, tool.name, isAssigned);
                }
              }}
              className={`p-3 rounded-2xl border backdrop-blur-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                missingCredential
                  ? 'bg-secondary/20 border-primary/10 opacity-60 cursor-not-allowed'
                  : isAssigned
                    ? 'bg-primary/10 border-primary/30 shadow-[0_0_15px_rgba(59,130,246,0.08)] cursor-pointer'
                    : 'bg-secondary/40 border-primary/15 hover:border-primary/20 cursor-pointer'
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <motion.div
                  animate={justToggledId === tool.id ? { scale: [1, 1.3, 1] } : {}}
                  transition={{ duration: 0.3 }}
                  className={`flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center mt-0.5 transition-colors ${
                    isAssigned
                      ? 'bg-primary border-primary'
                      : 'bg-background/50 border-primary/15'
                  }`}
                >
                  {isAssigned && <Check className="w-3 h-3 text-foreground" />}
                </motion.div>

                {/* Tool Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-medium text-foreground text-sm truncate">
                      {tool.name}
                    </h4>
                    {tool.requires_credential_type && (
                      credentialTypeSet.has(tool.requires_credential_type) ? (
                        <span title={`${credentialLabel(tool.requires_credential_type)} credential available`}><CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" /></span>
                      ) : (
                        <span title={`Needs ${credentialLabel(tool.requires_credential_type)} credential`}><AlertCircle className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" /></span>
                      )
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground/50 mt-1.5 line-clamp-2">
                    {tool.description}
                  </p>
                  {missingCredential && (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[11px] text-amber-400/80">
                        Requires a <span className="font-medium">{credentialLabel(tool.requires_credential_type!)}</span> credential to connect
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSidebarSection('credentials');
                          setCredentialView('add-new');
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-primary/80 hover:text-primary transition-colors group"
                      >
                        Add credential
                        <ArrowRight className="w-3 h-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {tool.category && (
                      <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-mono bg-background/50 text-muted-foreground/40 border border-primary/15">
                        {tool.category}
                      </span>
                    )}
                    {(usageByTool.get(tool.name) ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-primary/5 text-muted-foreground/50 border border-primary/10">
                        <BarChart3 className="w-3 h-3" />
                        {(usageByTool.get(tool.name) ?? 0).toLocaleString()} calls
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {filteredTools.length === 0 && (
        <div className="text-center py-8 text-muted-foreground/40 text-sm">
          {isSearching ? `No tools matching "${searchQuery.trim()}"` : 'No tools found in this category'}
        </div>
      )}

      {/* Undo toast for accidental removal */}
      <AnimatePresence>
        {undoToast && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-secondary/95 backdrop-blur-sm border border-primary/20 rounded-xl shadow-xl"
          >
            <span className="text-sm text-foreground/80">
              Removed <span className="font-medium text-foreground/90">{undoToast.toolName}</span>
            </span>
            <button
              onClick={handleUndo}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
