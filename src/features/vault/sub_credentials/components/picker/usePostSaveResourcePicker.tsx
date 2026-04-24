/**
 * Post-save orchestration for credential resource scoping.
 *
 * Flow: caller awaits `createCredential` → calls `promptIfScoped(credentialId, serviceType)`.
 * If the connector declares `resources[]`, we render the picker as a portal'd
 * modal and resolve the promise when it closes (commit or skip).
 *
 * The goal: no "Scope" tab in card details; the picker is a natural step at
 * credential-creation time, visible in both the manual schema form and the
 * auto-add / autopilot flows.
 */
import { useCallback, useState } from 'react';
import type { ConnectorDefinition, ResourceSpec } from '@/lib/types/types';
import { useVaultStore } from '@/stores/vaultStore';
import { ResourcePicker } from './ResourcePicker';

type PromptArgs = {
  credentialId: string;
  serviceType: string;
};

export function usePostSaveResourcePicker() {
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const [active, setActive] = useState<{
    credentialId: string;
    connectorLabel: string;
    specs: ResourceSpec[];
    resolve: () => void;
  } | null>(null);

  const promptIfScoped = useCallback(
    async ({ credentialId, serviceType }: PromptArgs): Promise<void> => {
      const connector = connectorDefinitions.find((c) => c.name === serviceType) as
        | (ConnectorDefinition & { resources?: ResourceSpec[] })
        | undefined;
      const specs = connector?.resources ?? [];
      if (!connector || specs.length === 0) return;

      return new Promise<void>((resolve) => {
        setActive({
          credentialId,
          connectorLabel: connector.label,
          specs,
          resolve,
        });
      });
    },
    [connectorDefinitions],
  );

  const element = active ? (
    <ResourcePicker
      credentialId={active.credentialId}
      connectorLabel={active.connectorLabel}
      specs={active.specs}
      onClose={() => {
        const r = active.resolve;
        setActive(null);
        r();
      }}
    />
  ) : null;

  return { promptIfScoped, element };
}
