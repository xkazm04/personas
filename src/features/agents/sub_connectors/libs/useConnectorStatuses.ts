import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { sendAppNotification } from '@/api/system/system';
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { mutateCredentialLink } from '@/hooks/design/core/useDesignContextMutator';
import { useTranslation } from '@/i18n/useTranslation';
import { connectorCategoryTags } from "@/lib/credentials/builtinConnectors";
import type { ConnectorStatus, ConnectorReadiness, ConnectorTestResult } from './connectorTypes';
import { deriveReadiness, restoreHealthcheck, isStaleResult } from './connectorTypes';

export function useConnectorStatuses() {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const credentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const healthcheckCredential = useVaultStore((s) => s.healthcheckCredential);
  const setConnectorTestActive = useSystemStore((s) => s.setConnectorTestActive);

  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [testingAll, setTestingAll] = useState(false);
  const inFlightTestsRef = useRef<Set<string>>(new Set());
  const lastAutoTestedCredentialRef = useRef<Map<string, string>>(new Map());

  const tools = useMemo(() => selectedPersona?.tools ?? [], [selectedPersona?.tools]);

  const requiredCredTypes = useMemo(() => {
    const types = new Set<string>();
    for (const tool of tools) {
      if (tool.requires_credential_type) types.add(tool.requires_credential_type);
    }
    return [...types];
  }, [tools]);

  const credentialLinks = useSelectedCredentialLinks();

  // Pre-build lookup maps to avoid O(N*M) linear searches. Each credential
  // gets indexed under its service_type AND every category tag the underlying
  // connector claims (e.g. a `github` credential is also reachable under
  // `source_control` and `codebase`). Templates routinely declare connector
  // requirements at the category level, so the strict-service-type-only index
  // used to leave every category-shaped slot reading as "missing credential"
  // even when a perfectly viable candidate sat in the vault.
  const credentialsByServiceType = useMemo(() => {
    const map = new Map<string, (typeof credentials)[number]>();
    for (const cred of credentials) {
      if (!map.has(cred.service_type)) map.set(cred.service_type, cred);
      for (const tag of connectorCategoryTags(cred.service_type)) {
        if (!map.has(tag)) map.set(tag, cred);
      }
    }
    return map;
  }, [credentials]);

  const credentialsByIdMap = useMemo(() => {
    const map = new Map<string, (typeof credentials)[number]>();
    for (const cred of credentials) map.set(cred.id, cred);
    return map;
  }, [credentials]);

  // Build connector statuses
  useEffect(() => {
    if (requiredCredTypes.length === 0) { setStatuses([]); return; }
    setStatuses((prev) => {
      const prevByName = new Map<string, ConnectorStatus>();
      for (const p of prev) prevByName.set(p.name, p);

      return requiredCredTypes.map((credType) => {
        const matchedCred = credentialsByServiceType.get(credType) ?? null;
        const existing = prevByName.get(credType);
        const linkedCredId = credentialLinks[credType];
        const linkedCred = linkedCredId ? credentialsByIdMap.get(linkedCredId) ?? null : null;
        const credentialId = existing?.credentialId ?? matchedCred?.id ?? linkedCred?.id ?? null;
        // Fall back to whatever the backend last recorded on the credential, so
        // a revisit opens with the known outcome instead of blank-then-retest.
        const resolvedCred = credentialId ? credentialsByIdMap.get(credentialId) ?? null : null;
        return {
          name: credType,
          credentialId,
          credentialName: existing?.credentialName ?? matchedCred?.name ?? linkedCred?.name ?? null,
          testing: existing?.testing ?? false,
          result: existing?.result ?? restoreHealthcheck(resolvedCred),
          linkError: existing?.linkError ?? null,
        };
      });
    });
  }, [requiredCredTypes, credentials, credentialLinks, credentialsByServiceType, credentialsByIdMap]);

  useEffect(() => { void fetchCredentials().catch(toastCatch("useConnectorStatuses:initialFetchCredentials", "Failed to load credentials. Connector statuses may be incomplete.")); }, [fetchCredentials]);

  useEffect(() => {
    lastAutoTestedCredentialRef.current.clear();
    inFlightTestsRef.current.clear();
  }, [selectedPersona?.id]);

  const updateStatus = useCallback((name: string, updates: Partial<ConnectorStatus>) => {
    setStatuses((prev) =>
      prev.map((status) => (status.name === name ? { ...status, ...updates } : status)),
    );
  }, []);

  // Returns the outcome so callers (handleTestAll) can diff a batch against the
  // results it replaced without re-reading state through a stale closure.
  const testConnector = useCallback(async (name: string, credentialId: string): Promise<ConnectorTestResult | null> => {
    if (inFlightTestsRef.current.has(name)) return null;
    inFlightTestsRef.current.add(name);
    updateStatus(name, { testing: true, result: null });
    try {
      const result = await healthcheckCredential(credentialId);
      updateStatus(name, { testing: false, result });
      return result;
    } catch (err) {
      const result: ConnectorTestResult = {
        success: false,
        message: err instanceof Error ? err.message : t.agents.connectors.test_healthcheck_failed_default,
      };
      updateStatus(name, { testing: false, result });
      return result;
    } finally {
      inFlightTestsRef.current.delete(name);
    }
  }, [healthcheckCredential, updateStatus, t]);

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
    // Snapshot before the batch so the notification can report what actually
    // CHANGED. Restored healthchecks make this baseline free — before they were
    // persisted there was nothing to diff against, so the notification could
    // only ever say "tested N connectors", which tells the user nothing.
    const baseline = new Map(testable.map((s) => [s.name, s.result?.success ?? null]));
    try {
      const outcomes = await Promise.all(
        testable.map(async (status) => ({
          name: status.name,
          result: await testConnector(status.name, status.credentialId!),
        })),
      );

      let recovered = 0;
      let regressed = 0;
      let failing = 0;
      for (const { name, result } of outcomes) {
        if (!result) continue;
        const before = baseline.get(name) ?? null;
        if (result.success) {
          if (before === false) recovered++;
        } else if (before === true) {
          regressed++;
        } else {
          failing++;
        }
      }

      const persona = selectedPersona?.name ?? t.agents.connectors.test_persona_fallback;
      const parts: string[] = [];
      if (recovered > 0) parts.push(tx(t.agents.connectors.test_diff_recovered, { count: recovered }));
      if (regressed > 0) parts.push(tx(t.agents.connectors.test_diff_regressed, { count: regressed }));
      if (failing > 0) parts.push(tx(t.agents.connectors.test_diff_failing, { count: failing }));

      sendAppNotification(
        t.agents.connectors.test_complete_notification_title,
        parts.length > 0
          ? `${persona} — ${parts.join(' · ')}`
          : tx(t.agents.connectors.test_complete_notification_body, { persona, count: testable.length }),
      ).catch(silentCatch("useConnectorStatuses:sendTestCompleteNotification"));
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
      // The design_context write queue reports failure through the RETURNED
      // result, never by rejecting (`applyDesignContextMutation` wraps its whole
      // body in try/catch and resolves `{ applied: false, reason }`). A
      // try/catch here was therefore unreachable: a persona that no longer
      // exists, or a failed `applyPersonaOp`, left the optimistic link on screen
      // and reported success, and the link was gone on the next mount.
      const outcome = await mutateCredentialLink(selectedPersona.id, connectorName, credentialId);
      if (!outcome.applied) {
        // Revert optimistic update -- the link was never persisted
        setStatuses((prev) =>
          prev.map((s) =>
            s.name === connectorName
              ? { ...s, credentialId: null, credentialName: null, result: null, linkError: tx(t.agents.connectors.test_link_failed, { error: outcome.reason }) }
              : s,
          ),
        );
        return false;
      }
    }
    await testConnector(connectorName, credentialId);
    return true;
  }, [selectedPersona, testConnector, t, tx]);

  const clearLinkError = useCallback((connectorName: string) => {
    updateStatus(connectorName, { linkError: null });
  }, [updateStatus]);

  const readinessCounts = useMemo(() => {
    const counts: Record<ConnectorReadiness, number> = {
      unlinked: 0, linked_untested: 0, healthy: 0, unverifiable: 0, unhealthy: 0,
    };
    for (const s of statuses) counts[deriveReadiness(s)]++;
    return counts;
  }, [statuses]);

  /** Rows whose only evidence is a restored healthcheck older than the cutoff. */
  const staleCount = useMemo(
    () => statuses.filter((s) => isStaleResult(s.result)).length,
    [statuses],
  );

  return {
    statuses,
    staleCount,
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
