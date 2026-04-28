import { useState, useEffect, useCallback, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useCredentialNav } from '@/features/vault/shared/hooks/CredentialNavContext';
import type { PersonaToolDefinition } from '@/lib/types/types';

/**
 * Tool toggle, undo, bulk, and add-credential actions.
 */
export function useToolSelectorActions(
  personaId: string,
  assignedToolIds: Set<string>,
  assignedTools: PersonaToolDefinition[],
) {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const assignTool = useAgentStore((s) => s.assignTool);
  const removeTool = useAgentStore((s) => s.removeTool);
  const bulkAssignTools = useAgentStore((s) => s.bulkAssignTools);
  const bulkRemoveTools = useAgentStore((s) => s.bulkRemoveTools);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const { navigate } = useCredentialNav();

  // The undo toast captures the personaId at the moment of removal. Undo
  // must route back to the *origin* persona (the one the tool was removed
  // from), not whatever persona happens to be selected when the user clicks
  // Undo — otherwise a fast persona switch between remove and undo would
  // re-assign the tool to the wrong agent. The persona-switch effect below
  // also dismisses the toast as a UX safeguard, but the captured-personaId
  // shape is the authoritative correctness guarantee.
  const [undoToast, setUndoToast] = useState<{
    toolId: string;
    toolName: string;
    personaId: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // Snapshot the personaId at call time so a switch mid-undo-window can't
      // reroute the undo to a different agent.
      const originPersonaId = personaId;
      await removeTool(originPersonaId, toolId);
      setUndoToast({ toolId, toolName, personaId: originPersonaId });
      undoTimerRef.current = setTimeout(() => setUndoToast(null), 5000);
    } else {
      await assignTool(personaId, toolId);
    }
  }, [clearUndoToast, removeTool, assignTool, personaId]);

  const handleUndo = useCallback(async () => {
    if (!undoToast) return;
    // Use the captured originating personaId, not the live `personaId` prop.
    await assignTool(undoToast.personaId, undoToast.toolId);
    clearUndoToast();
  }, [undoToast, assignTool, clearUndoToast]);

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
    undoToast,
    handleToggleTool,
    handleUndo,
    handleClearAll,
    handleBulkToggle,
    handleAddCredential,
  };
}
