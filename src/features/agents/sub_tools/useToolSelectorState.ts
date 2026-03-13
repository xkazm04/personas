import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useCredentialNav } from '@/features/vault/hooks/CredentialNavContext';

export function useToolSelectorState() {
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const toolDefinitions = useAgentStore((state) => state.toolDefinitions);
  const credentials = useVaultStore((state) => state.credentials);
  const assignTool = useAgentStore((state) => state.assignTool);
  const removeTool = useAgentStore((state) => state.removeTool);
  const bulkAssignTools = useAgentStore((state) => state.bulkAssignTools);
  const bulkRemoveTools = useAgentStore((state) => state.bulkRemoveTools);
  const setSidebarSection = useSystemStore((state) => state.setSidebarSection);
  const toolUsageSummary = useAgentStore((state) => state.toolUsageSummary);
  const fetchToolUsage = useAgentStore((state) => state.fetchToolUsage);
  const connectorDefinitions = useVaultStore((state) => state.connectorDefinitions);
  const { navigate } = useCredentialNav();

  const credentialLabel = useCallback((credType: string): string => {
    const connector = connectorDefinitions.find((c) => c.name === credType);
    if (connector) return connector.label;
    return getConnectorMeta(credType).label;
  }, [connectorDefinitions]);

  const credentialTypeSet = useMemo(() => {
    const set = new Set<string>();
    credentials.forEach(c => set.add(c.service_type));
    return set;
  }, [credentials]);

  useEffect(() => { fetchToolUsage(30); }, [fetchToolUsage]);

  const usageByTool = useMemo(() => {
    const map = new Map<string, number>();
    toolUsageSummary.forEach((s) => map.set(s.tool_name, s.total_invocations));
    return map;
  }, [toolUsageSummary]);

  const personaId = selectedPersona?.id || '';
  const assignedToolIds = useMemo(() => {
    const ids = selectedPersona?.tools?.map(t => t.id) || [];
    return new Set(ids);
  }, [selectedPersona?.tools]);

  const assignedTools = useMemo(() => {
    return toolDefinitions.filter((td) => assignedToolIds.has(td.id));
  }, [assignedToolIds, toolDefinitions]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    toolDefinitions.forEach((tool) => { if (tool.category) cats.add(tool.category); });
    return ['All', ...Array.from(cats)];
  }, [toolDefinitions]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set('All', toolDefinitions.length);
    for (const tool of toolDefinitions) {
      if (tool.category) counts.set(tool.category, (counts.get(tool.category) || 0) + 1);
    }
    return counts;
  }, [toolDefinitions]);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [justToggledId, setJustToggledId] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ toolId: string; toolName: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'grouped'>('grid');

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

  const connectorGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredTools>();
    for (const tool of filteredTools) {
      const key = tool.requires_credential_type || '__general__';
      const existing = groups.get(key);
      if (existing) existing.push(tool);
      else groups.set(key, [tool]);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '__general__') return 1;
      if (b[0] === '__general__') return -1;
      return a[0].localeCompare(b[0]);
    });
  }, [filteredTools]);

  const clearUndoToast = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast(null);
  }, []);

  useEffect(() => {
    clearUndoToast();
  }, [selectedPersona?.id, clearUndoToast]);

  const handleToggleTool = useCallback(async (toolId: string, toolName: string, isAssigned: boolean) => {
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
  }, [clearUndoToast, removeTool, assignTool, personaId]);

  const handleUndo = useCallback(async () => {
    if (!undoToast) return;
    await assignTool(personaId, undoToast.toolId);
    setJustToggledId(undoToast.toolId);
    setTimeout(() => setJustToggledId(null), 600);
    clearUndoToast();
  }, [undoToast, assignTool, personaId, clearUndoToast]);

  const handleClearAll = useCallback(async () => {
    clearUndoToast();
    await bulkRemoveTools(personaId, assignedTools.map((t) => t.id));
  }, [clearUndoToast, bulkRemoveTools, personaId, assignedTools]);

  const handleBulkToggle = useCallback(async (tools: Array<{ id: string }>, allAssigned: boolean) => {
    clearUndoToast();
    if (allAssigned) {
      await bulkRemoveTools(personaId, tools.filter((t) => assignedToolIds.has(t.id)).map((t) => t.id));
    } else {
      await bulkAssignTools(personaId, tools.filter((t) => !assignedToolIds.has(t.id)).map((t) => t.id));
    }
  }, [clearUndoToast, bulkRemoveTools, bulkAssignTools, personaId, assignedToolIds]);

  const handleAddCredential = useCallback(() => {
    setSidebarSection('credentials');
    navigate('add-new');
  }, [setSidebarSection, navigate]);

  return {
    selectedPersona,
    toolDefinitions,
    credentialLabel,
    credentialTypeSet,
    usageByTool,
    assignedToolIds,
    assignedTools,
    categories,
    categoryCounts,
    selectedCategory, setSelectedCategory,
    searchQuery, setSearchQuery,
    justToggledId,
    undoToast,
    viewMode, setViewMode,
    isSearching,
    filteredTools,
    connectorGroups,
    handleToggleTool,
    handleUndo,
    handleClearAll,
    handleBulkToggle,
    handleAddCredential,
  };
}
