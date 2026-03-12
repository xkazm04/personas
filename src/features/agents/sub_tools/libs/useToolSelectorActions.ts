import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useCredentialNav } from '@/features/vault/hooks/CredentialNavContext';
import type { DbPersonaToolDefinition } from '@/lib/types/types';

/**
 * Tool toggle, undo, bulk, and add-credential actions.
 * Manages the justToggledId flash and undo toast UI state.
 */
export function useToolSelectorActions(
  personaId: string,
  assignedToolIds: Set<string>,
  assignedTools: DbPersonaToolDefinition[],
) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const assignTool = usePersonaStore((s) => s.assignTool);
  const removeTool = usePersonaStore((s) => s.removeTool);
  const bulkAssignTools = usePersonaStore((s) => s.bulkAssignTools);
  const bulkRemoveTools = usePersonaStore((s) => s.bulkRemoveTools);
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const { navigate } = useCredentialNav();

  const [justToggledId, setJustToggledId] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ toolId: string; toolName: string } | null>(null);
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
    justToggledId,
    undoToast,
    handleToggleTool,
    handleUndo,
    handleClearAll,
    handleBulkToggle,
    handleAddCredential,
  };
}
