import { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { sendAppNotification } from '@/api/system';
import { parseDesignContext, mergeCredentialLink } from '@/features/shared/components/UseCasesList';
import { applyDesignContextMutation } from '@/features/agents/sub_editor/sub_use_cases/useCaseHelpers';
import type { ConnectorStatus } from './connectorTypes';

export function useConnectorStatuses() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const credentials = usePersonaStore((s) => s.credentials);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const healthcheckCredential = usePersonaStore((s) => s.healthcheckCredential);
  const setConnectorTestActive = usePersonaStore((s) => s.setConnectorTestActive);

  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [testingAll, setTestingAll] = useState(false);

  const tools = selectedPersona?.tools ?? [];

  const requiredCredTypes = useMemo(() => {
    const types = new Set<string>();
    for (const tool of tools) {
      if (tool.requires_credential_type) types.add(tool.requires_credential_type);
    }
    return [...types];
  }, [tools]);

  const credentialLinks = useMemo(
    () => parseDesignContext(selectedPersona?.design_context).credentialLinks ?? {},
    [selectedPersona?.design_context],
  );

  // Build connector statuses
  useEffect(() => {
    if (requiredCredTypes.length === 0) { setStatuses([]); return; }
    setStatuses((prev) =>
      requiredCredTypes.map((credType) => {
        const matchedCred = credentials.find((c) => c.service_type === credType);
        const existing = prev.find((p) => p.name === credType);
        const linkedCredId = credentialLinks[credType];
        const linkedCred = linkedCredId ? credentials.find((c) => c.id === linkedCredId) : null;
        return {
          name: credType,
          credentialId: existing?.credentialId ?? matchedCred?.id ?? linkedCred?.id ?? null,
          credentialName: existing?.credentialName ?? matchedCred?.name ?? linkedCred?.name ?? null,
          testing: existing?.testing ?? false,
          result: existing?.result ?? null,
        };
      }),
    );
  }, [requiredCredTypes, credentials, credentialLinks]);

  useEffect(() => { void fetchCredentials().catch(() => {}); }, [fetchCredentials]);

  // Auto-test on mount
  const [autoTested] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    for (const status of statuses) {
      if (status.credentialId && !status.result && !status.testing && !autoTested.has(status.name)) {
        autoTested.add(status.name);
        void testConnector(status.name, status.credentialId);
      }
    }
  }, [statuses]);

  const testConnector = useCallback(async (name: string, credentialId: string) => {
    setStatuses((prev) =>
      prev.map((s) => s.name === name ? { ...s, testing: true, result: null } : s),
    );
    try {
      const result = await healthcheckCredential(credentialId);
      setStatuses((prev) =>
        prev.map((s) => s.name === name ? { ...s, testing: false, result } : s),
      );
    } catch (err) {
      setStatuses((prev) =>
        prev.map((s) =>
          s.name === name
            ? { ...s, testing: false, result: { success: false, message: err instanceof Error ? err.message : 'Healthcheck failed' } }
            : s,
        ),
      );
    }
  }, [healthcheckCredential]);

  const handleTestAll = async () => {
    setTestingAll(true);
    setConnectorTestActive(true);
    const testable = statuses.filter((s) => s.credentialId);
    for (const status of testable) {
      await testConnector(status.name, status.credentialId!);
    }
    setTestingAll(false);
    setConnectorTestActive(false);
    const persona = selectedPersona?.name ?? 'Persona';
    sendAppNotification(
      'Connector Tests Complete',
      `${persona}: All ${testable.length} connector tests finished.`,
    ).catch(() => {});
  };

  const handleLinkCredential = useCallback((connectorName: string, credentialId: string, credentialName: string) => {
    setStatuses((prev) =>
      prev.map((s) =>
        s.name === connectorName ? { ...s, credentialId, credentialName, result: null } : s,
      ),
    );
    if (selectedPersona) {
      void applyDesignContextMutation(selectedPersona.id, (ctx) =>
        mergeCredentialLink(ctx, connectorName, credentialId),
      );
    }
    void testConnector(connectorName, credentialId);
  }, [selectedPersona, testConnector]);

  return {
    statuses,
    tools,
    requiredCredTypes,
    credentials,
    testingAll,
    fetchCredentials,
    testConnector,
    handleTestAll,
    handleLinkCredential,
  };
}
