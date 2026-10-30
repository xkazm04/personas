import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useSystemStore } from "@/stores/systemStore";
import { sendAppNotification } from '@/api/system/system';
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { mutateCredentialLink } from '@/hooks/design/core/useDesignContextMutator';
import { useTranslation } from '@/i18n/useTranslation';
import { createLatestWins } from '@/stores/util/latestWins';
import { connectorCategoryTags } from "@/lib/credentials/builtinConnectors";
import type { ConnectorStatus, ConnectorReadiness, ConnectorTestResult } from './connectorTypes';
import { deriveReadiness, restoreHealthcheck, isStaleResult, isUnreachable, summarizeTestAll } from './connectorTypes';

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
  // Persona epoch: bumped on every persona switch so a probe still in flight for
  // the previous persona cannot paint its result onto the new persona's same-named row.
  const personaEpochRef = useRef(createLatestWins());
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
    // Newest wins, matching the runner (`get_by_service_type ... ORDER BY
    // created_at DESC`, then `.first()`). Taking the first in store order made the
    // row name and auto-test a credential the run never injects whenever the
    // store list was not newest-first (an optimistic create appends).
    const newer = (a: (typeof credentials)[number] | undefined, b: (typeof credentials)[number]) =>
      !a || (b.created_at ?? '') > (a.created_at ?? '');
    for (const cred of credentials) {
      if (newer(map.get(cred.service_type), cred)) map.set(cred.service_type, cred);
      for (const tag of connectorCategoryTags(cred.service_type)) {
        if (newer(map.get(tag), cred)) map.set(tag, cred);
      }
    }
    return map;
  }, [credentials]);

  const credentialsByIdMap = useMemo(() => {
    const map = new Map<string, (typeof credentials)[number]>();
    for (const cred of credentials) map.set(cred.id, cred);
    return map;
  }, [credentials]);

  // Which persona the current rows were built for. The hook stays mounted
  // across a persona switch (the Connectors sub-tab is not keyed by persona),
  // so rows carried over by connector NAME handed persona B persona A's
  // credential, name and result for every connector the two share.
  const builtForPersonaRef = useRef<string | null>(null);
  const personaId = selectedPersona?.id ?? null;
  // The persisted links the current rows were built from. A carried row
  // outranks the link only while the link is unchanged (an optimistic link in
  // flight); a link that CHANGED was written by someone -- AgentCredentialDemands'
  // reuse writes it through mutateCredentialLink, never through this hook -- and
  // it outranks the carried row, which still names the auto-matched credential.
  const builtFromLinksRef = useRef<Record<string, string>>({});

  // Build connector statuses
  useEffect(() => {
    const samePersona = builtForPersonaRef.current === personaId;
    builtForPersonaRef.current = personaId;
    const previousLinks = builtFromLinksRef.current;
    builtFromLinksRef.current = credentialLinks;
    if (requiredCredTypes.length === 0) { setStatuses([]); return; }
    setStatuses((prev) => {
      const prevByName = new Map<string, ConnectorStatus>();
      if (samePersona) {
        for (const p of prev) {
          // A row whose credential left the vault is not carried either: it
          // kept naming (and testing) a credential that no longer exists.
          if (p.credentialId && !credentialsByIdMap.has(p.credentialId)) continue;
          // Nor is a row whose persisted link changed under it to a
          // credential other than the one it holds.
          const link = credentialLinks[p.name];
          if (link && link !== previousLinks[p.name] && link !== p.credentialId && credentialsByIdMap.has(link)) continue;
          prevByName.set(p.name, p);
        }
      }

      return requiredCredTypes.map((credType) => {
        const matchedCred = credentialsByServiceType.get(credType) ?? null;
        const existing = prevByName.get(credType);
        const linkedCredId = credentialLinks[credType];
        const linkedCred = linkedCredId ? credentialsByIdMap.get(linkedCredId) ?? null : null;
        // The EXPLICIT link wins over the auto-match. `matchedCred` is the NEWEST
        // credential of that service_type (the one the runner injects), not the
        // user's pick, so with two credentials for one connector the user's own
        // choice -- persisted into design_context.credentialLinks by
        // CredentialPicker -- was discarded on every fresh mount and the tab
        // tested (and reported readiness for) the newest sibling instead.
        // `useUnfulfilledCredentials` already treats the link as authoritative;
        // this now agrees with it.
        // A link pointing at a deleted credential resolves to null and still
        // falls through to the auto-match.
        const credentialId = existing?.credentialId ?? linkedCred?.id ?? matchedCred?.id ?? null;
        // Fall back to whatever the backend last recorded on the credential, so
        // a revisit opens with the known outcome instead of blank-then-retest.
        const resolvedCred = credentialId ? credentialsByIdMap.get(credentialId) ?? null : null;
        return {
          name: credType,
          credentialId,
          credentialName: existing?.credentialName ?? linkedCred?.name ?? matchedCred?.name ?? null,
          testing: existing?.testing ?? false,
          result: existing?.result ?? restoreHealthcheck(resolvedCred),
          lastVerdict: existing?.lastVerdict ?? null,
          linkError: existing?.linkError ?? null,
        };
      });
    });
  }, [personaId, requiredCredTypes, credentials, credentialLinks, credentialsByServiceType, credentialsByIdMap]);

  // The vault slice exposes no loaded flag, so an empty list cannot tell "none"
  // from "not yet". Track the first fetch here: until it settles an empty vault
  // must not read as N missing connectors (the amber "execution blocked" banner
  // flashed on every cold mount). A non-empty list is already proof of a load.
  const [fetchSettled, setFetchSettled] = useState(false);
  const credentialsLoaded = fetchSettled || credentials.length > 0;
  useEffect(() => {
    let live = true;
    // A failed fetch is reported by toastCatch (it tells the user statuses may be
    // incomplete); either way the attempt is over, so the claim can be shown.
    void fetchCredentials()
      .catch(toastCatch("useConnectorStatuses:initialFetchCredentials", "Failed to load credentials. Connector statuses may be incomplete."))
      .finally(() => { if (live) setFetchSettled(true); });
    return () => { live = false; };
  }, [fetchCredentials]);

  useEffect(() => {
    lastAutoTestedCredentialRef.current.clear();
    inFlightTestsRef.current.clear();
    personaEpochRef.current.next();
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
    const epoch = personaEpochRef.current;
    const token = epoch.current();
    // Clearing `result` for the spinner must not lose the last real verdict: keep
    // it aside, so an unreachable attempt can be shown beside it.
    setStatuses((prev) => prev.map((s) => {
      if (s.name !== name) return s;
      const verdict = s.result && !isUnreachable(s.result) ? s.result : s.lastVerdict ?? null;
      return { ...s, testing: true, result: null, lastVerdict: verdict };
    }));
    try {
      const result = await healthcheckCredential(credentialId);
      if (epoch.isCurrent(token)) {
        // A real verdict supersedes the kept one; an unreachable attempt does not.
        updateStatus(name, isUnreachable(result)
          ? { testing: false, result }
          : { testing: false, result, lastVerdict: null });
      }
      return result;
    } catch (err) {
      // A probe that threw never asked the service: the same `unreachable`
      // token the store returns for a transport failure, never a red verdict.
      // Without a state the row resolved to `failed` from `success: false`.
      const result: ConnectorTestResult = {
        success: false,
        message: err instanceof Error ? err.message : t.agents.connectors.test_healthcheck_failed_default,
        state: 'unreachable',
      };
      if (epoch.isCurrent(token)) updateStatus(name, { testing: false, result });
      return result;
    } finally {
      // A switch already cleared the set; the name may now belong to the new persona's probe.
      if (epoch.isCurrent(token)) inFlightTestsRef.current.delete(name);
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
    const baseline = new Map(testable.map((s) => [s.name, s.result]));
    try {
      const outcomes = await Promise.all(
        testable.map(async (status) => ({
          name: status.name,
          result: await testConnector(status.name, status.credentialId!),
        })),
      );

      // Verdicts only: an unreachable probe (success === false, but no verdict)
      // used to count as "newly failing" against a passing baseline. It is
      // reported on its own ("N couldn't be reached") instead.
      const { recovered, regressed, failing, unreachable } = summarizeTestAll(outcomes, baseline);

      const persona = selectedPersona?.name ?? t.agents.connectors.test_persona_fallback;
      const parts: string[] = [];
      if (recovered > 0) parts.push(tx(t.agents.connectors.test_diff_recovered, { count: recovered }));
      if (regressed > 0) parts.push(tx(t.agents.connectors.test_diff_regressed, { count: regressed }));
      if (failing > 0) parts.push(tx(t.agents.connectors.test_diff_failing, { count: failing }));
      if (unreachable > 0) parts.push(tx(t.agents.connectors.test_diff_unreachable, { count: unreachable }));

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
    // The row this optimistic link replaces. A write that never persists
    // leaves the persisted link -- and what the runner injects -- unchanged,
    // so the revert restores this row rather than painting it unlinked.
    let replaced: ConnectorStatus | undefined;
    setStatuses((prev) =>
      prev.map((s) => {
        if (s.name !== connectorName) return s;
        replaced = s;
        return { ...s, credentialId, credentialName, result: null, linkError: null };
      }),
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
        // The queue resolves rather than throws, so this is the only place the
        // lost write can be counted; the row's linkError reaches no telemetry.
        silentCatch('useConnectorStatuses:linkCredential')(new Error(outcome.reason));
        // Revert optimistic update -- the link was never persisted
        const linkError = tx(t.agents.connectors.test_link_failed, { error: outcome.reason });
        setStatuses((prev) =>
          prev.map((s) =>
            s.name === connectorName
              ? (replaced
                ? { ...replaced, testing: false, linkError }
                : { ...s, credentialId: null, credentialName: null, result: null, linkError })
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
      unlinked: 0, linked_untested: 0, healthy: 0, unverifiable: 0, unreachable: 0, unhealthy: 0,
    };
    for (const s of statuses) counts[deriveReadiness(s)]++;
    // Before the vault has loaded every link resolves to null: that is "unknown",
    // not "missing", so no count may claim execution is blocked yet.
    if (!credentialsLoaded) counts.unlinked = 0;
    return counts;
  }, [statuses, credentialsLoaded]);

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
    credentialsLoaded,
    fetchCredentials,
    testConnector,
    handleTestAll,
    handleLinkCredential,
    clearLinkError,
  };
}
