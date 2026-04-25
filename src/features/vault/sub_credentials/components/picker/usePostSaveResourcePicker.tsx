/**
 * Caller-side hook — fires the global resource-picker store.
 *
 * After a credential save, callers do:
 *   await promptIfScoped({ credentialId, serviceType });
 *
 * The promise resolves when the user commits, skips, or cancels the picker
 * (or immediately when the connector has no `resources[]`). The picker UI
 * itself lives in `<ResourcePickerHost />` mounted at App root, so the
 * promise survives the caller's parent unmounting on view transitions
 * (Catalog GO_LIST after save, autopilot reset, edit form close).
 */
import { useCallback } from 'react';
import type { ConnectorDefinition, ResourceSpec } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';
import { useResourcePickerStore } from './resourcePickerStore';

type PromptArgs = {
  credentialId: string;
  serviceType: string;
};

export function usePostSaveResourcePicker() {
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const prompt = useResourcePickerStore((s) => s.prompt);

  const promptIfScoped = useCallback(
    async ({ credentialId, serviceType }: PromptArgs): Promise<void> => {
      const connector = connectorDefinitions.find((c) => c.name === serviceType) as
        | (ConnectorDefinition & { resources?: ResourceSpec[] })
        | undefined;
      const specs = connector?.resources ?? [];
      if (!connector || specs.length === 0) return;
      await prompt({
        credentialId,
        connectorLabel: connector.label,
        specs,
      });
    },
    [connectorDefinitions, prompt],
  );

  return { promptIfScoped };
}
