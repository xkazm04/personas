import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useCredentialNav } from '@/features/vault/shared/hooks/CredentialNavContext';
import { toastCatch } from '@/lib/silentCatch';
import { GENERAL_GROUP_KEY, toGroupKey } from './libs/connectorGroupKey';

/**
 * Undo-toast contract (pinned 2026-04-20):
 *
 * - Duration: [`UNDO_TOAST_MS`] after a successful remove. If the user does
 *   nothing, the removal is permanent.
 * - Single-slot, last-write-wins: a new remove replaces any in-flight undo.
 *   Undos do NOT stack; the older removal is finalized and no longer
 *   recoverable via this UI.
 * - Persona switch: switching personas clears the undo window. A cross-persona
 *   click that lands on the wrong agent is a worse UX than losing one undo.
 * - Background store failures: the store slice emits error state; optimistic
 *   toggles must be invalidated there. This hook additionally surfaces a
 *   toast via [`toastCatch`] so the user sees WHY their click failed.
 */
const UNDO_TOAST_MS = 5_000;

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
  // Undo toast captures the persona the removal came from, NOT the currently-
  // selected persona. This is what prevents a fast "remove tool → switch persona
  // → undo" sequence from re-assigning the tool to the wrong agent.
  const [undoToast, setUndoToast] = useState<{ toolId: string; toolName: string; personaId: string } | null>(null);
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
      const key = toGroupKey(tool.requires_credential_type);
      const existing = groups.get(key);
      if (existing) existing.push(tool);
      else groups.set(key, [tool]);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === GENERAL_GROUP_KEY) return 1;
      if (b[0] === GENERAL_GROUP_KEY) return -1;
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
    // Snapshot the persona at click time so a fast persona-switch mid-request
    // cannot cause the undo toast to act on a different agent.
    const pid = personaId;
    try {
      if (isAssigned) {
        await removeTool(pid, toolId);
        setUndoToast({ toolId, toolName, personaId: pid });
        undoTimerRef.current = setTimeout(() => setUndoToast(null), UNDO_TOAST_MS);
      } else {
        await assignTool(pid, toolId);
      }
    } catch (err) {
      // Store slice also sets error state, but route through toastCatch so
      // the user sees WHY their click failed instead of a silently-reverted
      // optimistic check.
      toastCatch(`useToolSelectorState:toggleTool:${isAssigned ? 'remove' : 'assign'}`)(err);
    }
  }, [clearUndoToast, removeTool, assignTool, personaId]);

  const handleUndo = useCallback(async () => {
    if (!undoToast) return;
    // Reassign to the persona the removal came FROM, not the currently selected
    // one. This is the whole point of capturing personaId in the toast.
    const { personaId: originPersonaId, toolId } = undoToast;
    try {
      await assignTool(originPersonaId, toolId);
    } catch (err) {
      toastCatch('useToolSelectorState:undoAssign')(err);
    }
    clearUndoToast();
  }, [undoToast, assignTool, clearUndoToast]);

  const handleClearAll = useCallback(async () => {
    clearUndoToast();
    try {
      await bulkRemoveTools(personaId, assignedTools.map((t) => t.id));
    } catch (err) {
      toastCatch('useToolSelectorState:clearAll')(err);
    }
  }, [clearUndoToast, bulkRemoveTools, personaId, assignedTools]);

  const handleBulkToggle = useCallback(async (tools: Array<{ id: string }>, allAssigned: boolean) => {
    clearUndoToast();
    try {
      if (allAssigned) {
        await bulkRemoveTools(personaId, tools.filter((t) => assignedToolIds.has(t.id)).map((t) => t.id));
      } else {
        await bulkAssignTools(personaId, tools.filter((t) => !assignedToolIds.has(t.id)).map((t) => t.id));
      }
    } catch (err) {
      toastCatch(`useToolSelectorState:bulkToggle:${allAssigned ? 'remove' : 'assign'}`)(err);
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
