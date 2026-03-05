import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { sendAppNotification } from '@/api/system';
import { parseDesignContext, mergeCredentialLink } from '@/features/shared/components/UseCasesList';
import { applyDesignContextMutation } from '@/features/agents/sub_use_cases/useCaseHelpers';
import type { ConnectorStatus } from './connectorTypes';

export function useConnectorStatuses() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const credentials = usePersonaStore((s) => s.credentials);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const healthcheckCredential = usePersonaStore((s) => s.healthcheckCredential);
  const setConnectorTestActive = usePersonaStore((s) => s.setConnectorTestActive);

  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [testingAll, setTestingAll] = useState(false);
  const inFlightTestsRef = useRef<Set<string>>(new Set());
  const lastAutoTestedCredentialRef = useRef<Map<string, string>>(new Map());

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

  useEffect(() => {
    lastAutoTestedCredentialRef.current.clear();
    inFlightTestsRef.current.clear();
  }, [selectedPersona?.id]);

  const updateStatus = useCallback((name: string, updates: Partial<ConnectorStatus>) => {
    setStatuses((prev) =>
      prev.map((status) => (status.name === name ? { ...status, ...updates } : status)),
    );
  }, []);

  const testConnector = useCallback(async (name: string, credentialId: string) => {
    if (inFlightTestsRef.current.has(name)) return;
    inFlightTestsRef.current.add(name);
    updateStatus(name, { testing: true, result: null });
    try {
      const result = await healthcheckCredential(credentialId);
      updateStatus(name, { testing: false, result });
    } catch (err) {
      updateStatus(name, {
        testing: false,
        result: { success: false, message: err instanceof Error ? err.message : 'Healthcheck failed' },
      });
    } finally {
      inFlightTestsRef.current.delete(name);
    }
  }, [healthcheckCredential, updateStatus]);

  // Auto-test when rows gain credentials, keyed by connector + credential.
  // This avoids duplicate auto-tests while still re-testing when a link changes.
  useEffect(() => {
    for (const status of statuses) {
      const credentialId = status.credentialId;
      const lastAutoCredential = lastAutoTestedCredentialRef.current.get(status.name);
      if (
        credentialId
        && !status.result
        && !status.testing
        && lastAutoCredential !== credentialId
        && !inFlightTestsRef.current.has(status.name)
      ) {
        lastAutoTestedCredentialRef.current.set(status.name, credentialId);
        void testConnector(status.name, credentialId);
      }
    }
  }, [statuses, testConnector]);

  const handleTestAll = async () => {
    setTestingAll(true);
    setConnectorTestActive(true);
    const testable = statuses.filter((s) => s.credentialId);
    try {
      for (const status of testable) {
        await testConnector(status.name, status.credentialId!);
      }
      const persona = selectedPersona?.name ?? 'Persona';
      sendAppNotification(
        'Connector Tests Complete',
        `${persona}: All ${testable.length} connector tests finished.`,
      ).catch(() => {});
    } finally {
      setTestingAll(false);
      setConnectorTestActive(false);
    }
  };

  const handleLinkCredential = useCallback(async (connectorName: string, credentialId: string, credentialName: string) => {
    lastAutoTestedCredentialRef.current.delete(connectorName);
    setStatuses((prev) =>
      prev.map((s) =>
        s.name === connectorName ? { ...s, credentialId, credentialName, result: null } : s,
      ),
    );
    if (selectedPersona) {
      try {
        await applyDesignContextMutation(selectedPersona.id, (ctx) =>
          mergeCredentialLink(ctx, connectorName, credentialId),
        );
      } catch (err) {
        // Revert optimistic update — the link was never persisted
        setStatuses((prev) =>
          prev.map((s) =>
            s.name === connectorName
              ? { ...s, credentialId: null, credentialName: null, result: { success: false, message: `Link failed: ${err instanceof Error ? err.message : 'unknown error'}` } }
              : s,
          ),
        );
        return;
      }
    }
    await testConnector(connectorName, credentialId);
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
