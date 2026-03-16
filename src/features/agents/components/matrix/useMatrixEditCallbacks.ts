/**
 * Bridge between MatrixEditCallbacks interface and the Zustand buildEditState.
 *
 * Returns a stable MatrixEditCallbacks object that writes edits to the store
 * and marks the session as dirty (requiring "Apply Changes" to sync to CLI).
 */
import { useCallback, useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import type { MatrixEditCallbacks } from "@/features/templates/sub_generated/gallery/matrix/matrixEditTypes";

export function useMatrixEditCallbacks(): MatrixEditCallbacks {
  const onCredentialSelect = useCallback((connectorName: string, credentialId: string) => {
    const s = useAgentStore.getState();
    s.updateEditState({
      connectorCredentialMap: { ...s.buildEditState.connectorCredentialMap, [connectorName]: credentialId },
    });
    s.linkBuildConnector(connectorName, credentialId);
    s.markEditDirty();
  }, []);

  const onConnectorSwap = useCallback((originalName: string, replacementName: string) => {
    const s = useAgentStore.getState();
    s.updateEditState({
      connectorSwaps: { ...s.buildEditState.connectorSwaps, [originalName]: replacementName },
    });
    s.markEditDirty();
  }, []);

  const onTriggerConfigChange = useCallback((index: number, config: Record<string, string>) => {
    const s = useAgentStore.getState();
    s.updateEditState({
      triggerConfigs: { ...s.buildEditState.triggerConfigs, [index]: config },
    });
    s.markEditDirty();
  }, []);

  const onToggleApproval = useCallback((value: boolean) => {
    useAgentStore.getState().updateEditState({ requireApproval: value });
    useAgentStore.getState().markEditDirty();
  }, []);

  const onToggleMemory = useCallback((value: boolean) => {
    useAgentStore.getState().updateEditState({ memoryEnabled: value });
    useAgentStore.getState().markEditDirty();
  }, []);

  const onPreferenceChange = useCallback((key: string, value: unknown) => {
    useAgentStore.getState().updateEditState({ [key]: value } as Record<string, unknown>);
    useAgentStore.getState().markEditDirty();
  }, []);

  const onErrorStrategyChange = useCallback((value: string) => {
    useAgentStore.getState().updateEditState({ errorStrategy: value });
    useAgentStore.getState().markEditDirty();
  }, []);

  const onUseCaseAdd = useCallback((title: string) => {
    const s = useAgentStore.getState();
    const current = s.buildEditState.useCases ?? [];
    s.updateEditState({
      useCases: [...current, { id: `uc-${Date.now()}`, title, category: 'general' }],
    });
    s.markEditDirty();
  }, []);

  const onUseCaseRemove = useCallback((id: string) => {
    const s = useAgentStore.getState();
    s.updateEditState({
      useCases: (s.buildEditState.useCases ?? []).filter((uc) => uc.id !== id),
    });
    s.markEditDirty();
  }, []);

  const onUseCaseUpdate = useCallback((id: string, title: string) => {
    const s = useAgentStore.getState();
    s.updateEditState({
      useCases: (s.buildEditState.useCases ?? []).map((uc) =>
        uc.id === id ? { ...uc, title } : uc,
      ),
    });
    s.markEditDirty();
  }, []);

  return useMemo(() => ({
    onCredentialSelect,
    onConnectorSwap,
    onTriggerConfigChange,
    onToggleApproval,
    onToggleMemory,
    onPreferenceChange,
    onErrorStrategyChange,
    onUseCaseAdd,
    onUseCaseRemove,
    onUseCaseUpdate,
  }), [
    onCredentialSelect, onConnectorSwap, onTriggerConfigChange,
    onToggleApproval, onToggleMemory, onPreferenceChange,
    onErrorStrategyChange, onUseCaseAdd, onUseCaseRemove, onUseCaseUpdate,
  ]);
}
