import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { sendAppNotification } from '@/api/system/system';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { mutateCredentialLink } from '@/hooks/design/core/useDesignContextMutator';
import type { ConnectorStatus, ConnectorReadiness } from './connectorTypes';
import { deriveReadiness } from './connectorTypes';

export function useConnectorStatuses() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const credentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const healthcheckCredential = useVaultStore((s) => s.healthcheckCredential);
  const setConnectorTestActive = useSystemStore((s) => s.setConnectorTestActive);

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

  const credentialLinks = useSelectedCredentialLinks();

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
          linkError: existing?.linkError ?? null,
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

  // Reset auto-test guard when credentialId changes so re-linking triggers a fresh test.
  const prevCredentialIdsRef = useRef<Map<string, string | null>>(new Map());
  useEffect(() => {
    for (const status of statuses) {
      const prevCredId = prevCredentialIdsRef.current.get(status.name);
      if (prevCredId !== undefined && prevCredId !== status.credentialId) {
        // Credential changed -- allow auto-test for this connector again
        lastAutoTestedCredentialRef.current.delete(status.name);
      }
      prevCredentialIdsRef.current.set(status.name, status.credentialId);
    }
  }, [statuses]);

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

  const testAllActiveRef = useRef(false);

  const handleTestAll = async () => {
    if (testAllActiveRef.current) return;
    testAllActiveRef.current = true;
    setTestingAll(true);
    setConnectorTestActive(true);
    const testable = statuses.filter((s) => s.credentialId);
    try {
      await Promise.allSettled(
        testable.map((status) => testConnector(status.name, status.credentialId!)),
      );
      const persona = selectedPersona?.name ?? 'Persona';
      sendAppNotification(
        'Connector Tests Complete',
        `${persona}: All ${testable.length} connector tests finished.`,
      ).catch(() => {});
    } finally {
      testAllActiveRef.current = false;
      setTestingAll(false);
      setConnectorTestActive(false);
    }
  };

  const handleLinkCredential = useCallback(async (connectorName: string, credentialId: string, credentialName: string): Promise<boolean> => {
    lastAutoTestedCredentialRef.current.delete(connectorName);
    setStatuses((prev) =>
      prev.map((s) =>
        s.name === connectorName ? { ...s, credentialId, credentialName, result: null, linkError: null } : s,
      ),
    );
    if (selectedPersona) {
      try {
        await mutateCredentialLink(selectedPersona.id, connectorName, credentialId);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'unknown error';
        // Revert optimistic update -- the link was never persisted
        setStatuses((prev) =>
          prev.map((s) =>
            s.name === connectorName
              ? { ...s, credentialId: null, credentialName: null, result: null, linkError: `Link failed: ${errorMsg}` }
              : s,
          ),
        );
        return false;
      }
    }
    await testConnector(connectorName, credentialId);
    return true;
  }, [selectedPersona, testConnector]);

  const clearLinkError = useCallback((connectorName: string) => {
    updateStatus(connectorName, { linkError: null });
  }, [updateStatus]);

  const readinessCounts = useMemo(() => {
    const counts: Record<ConnectorReadiness, number> = {
      unlinked: 0, linked_untested: 0, healthy: 0, unhealthy: 0,
    };
    for (const s of statuses) counts[deriveReadiness(s)]++;
    return counts;
  }, [statuses]);

  return {
    statuses,
    tools,
    requiredCredTypes,
    credentials,
    testingAll,
    readinessCounts,
    fetchCredentials,
    testConnector,
    handleTestAll,
    handleLinkCredential,
    clearLinkError,
  };
}
