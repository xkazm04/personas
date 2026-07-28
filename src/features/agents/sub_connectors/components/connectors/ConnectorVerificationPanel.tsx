import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { CredentialDesignModal } from '@/features/vault/sub_catalog/components/design/CredentialDesignModal';
import { silentCatch } from '@/lib/silentCatch';
import { getRoleForConnector, resolveRoleLabel } from '@/lib/credentials/connectorRoles';
import type { useConnectorStatuses } from '../../libs/useConnectorStatuses';
import type { ConnectorStatus, ConnectorHealthFilter } from '../../libs/connectorTypes';
import { matchesHealthFilter } from '../../libs/connectorTypes';
import { ConnectorsSection, ReadinessWarnings } from './ConnectorsTabSections';

export type ConnectorVerification = ReturnType<typeof useConnectorStatuses>;

interface ConnectorVerificationPanelProps {
  /**
   * The `useConnectorStatuses` instance to render. Passed in rather than called
   * here so a host can share ONE instance with its other connector surfaces —
   * two instances would run two independent auto-test loops against the same
   * credentials.
   */
  verification: ConnectorVerification;
  /** Reported whenever the count of connectors with no linked credential changes. */
  onMissingCountChange?: (count: number) => void;
}

/**
 * Live connector verification for the selected persona: per-connector test,
 * test-all, link-an-existing-credential, add-new and swap-to-an-alternative.
 *
 * Unlike the design-preview `ConnectorsSection` (which reflects what the *build*
 * proposed), this reads the persona's actual tools via `useConnectorStatuses`,
 * so it stays accurate for personas that were never designed and reacts to
 * credentials being linked or going unhealthy after the fact.
 */
export function ConnectorVerificationPanel({ verification, onMissingCountChange }: ConnectorVerificationPanelProps) {
  const { t } = useTranslation();
  const {
    statuses, requiredCredTypes, credentials, testingAll, readinessCounts, staleCount,
    fetchCredentials, testConnector, handleTestAll, handleLinkCredential, clearLinkError,
  } = verification;

  const [linkingConnector, setLinkingConnector] = useState<string | null>(null);
  const [healthFilter, setHealthFilter] = useState<ConnectorHealthFilter | null>(null);
  const [designInstruction, setDesignInstruction] = useState<string | null>(null);

  const handleAddCredential = useCallback((connectorName: string) => {
    setLinkingConnector(null);
    setDesignInstruction(`${connectorName} API credential`);
  }, []);

  const handleDesignComplete = useCallback(() => {
    setDesignInstruction(null);
    void fetchCredentials().catch(silentCatch('ConnectorVerificationPanel:fetchCredentialsOnDesignComplete'));
  }, [fetchCredentials]);

  const handleLink = useCallback(async (connectorName: string, credentialId: string, credentialName: string) => {
    setLinkingConnector(null);
    const ok = await handleLinkCredential(connectorName, credentialId, credentialName);
    // Re-open the picker on failure so the error is visible next to a retry.
    if (!ok) setLinkingConnector(connectorName);
  }, [handleLinkCredential]);

  // A swap means "use this alternative instead" — the alternative needs a
  // credential before it can do anything, so route straight to provisioning.
  const handleSwap = useCallback((_currentName: string, newName: string) => {
    handleAddCredential(newName);
  }, [handleAddCredential]);

  // Group interchangeable connectors (same functional role) under one heading
  // so "Slack or Discord" reads as one decision rather than two failures.
  const roleGroups = useMemo(() => {
    const groups: { roleLabel: string; items: ConnectorStatus[] }[] = [];
    const grouped = new Set<string>();
    // Filter AFTER grouping decisions are made from the full set, so a role's
    // heading still reflects that the connectors are interchangeable even when
    // only one member matches the active filter.
    const visible = (items: ConnectorStatus[]) => items.filter((s) => matchesHealthFilter(s, healthFilter));

    for (const status of statuses) {
      if (grouped.has(status.name)) continue;
      const role = getRoleForConnector(status.name);
      if (role) {
        const members = statuses.filter((s) => role.members.includes(s.name));
        for (const m of members) grouped.add(m.name);
        const shown = visible(members);
        if (shown.length > 0) groups.push({ roleLabel: resolveRoleLabel(role, t), items: shown });
      } else {
        grouped.add(status.name);
        if (matchesHealthFilter(status, healthFilter)) {
          groups.push({ roleLabel: '', items: [status] });
        }
      }
    }
    return groups;
  }, [statuses, t, healthFilter]);

  // A pill disappears once its count hits zero, so an active filter that stops
  // matching would strand the user on an empty list with nothing left to click
  // to clear it — e.g. filter by "failing", then re-test and it recovers.
  const filterHasMatches = useMemo(
    () => statuses.some((s) => matchesHealthFilter(s, healthFilter)),
    [statuses, healthFilter],
  );
  useEffect(() => {
    if (healthFilter && !filterHasMatches) setHealthFilter(null);
  }, [healthFilter, filterHasMatches]);

  const { unlinked, healthy, unhealthy, unverifiable } = readinessCounts;
  const testableCount = statuses.filter((s) => s.credentialId).length;

  useEffect(() => { onMissingCountChange?.(unlinked); }, [unlinked, onMissingCountChange]);

  if (requiredCredTypes.length === 0) return null;

  return (
    <div className="space-y-3">
      <ReadinessWarnings unlinked={unlinked} unhealthy={unhealthy} />
      <ConnectorsSection
        roleGroups={roleGroups}
        requiredCredTypes={requiredCredTypes}
        healthy={healthy}
        unhealthy={unhealthy}
        unlinked={unlinked}
        unverifiable={unverifiable}
        staleCount={staleCount}
        testableCount={testableCount}
        testingAll={testingAll}
        credentials={credentials}
        linkingConnector={linkingConnector}
        onTestAll={() => void handleTestAll()}
        onTestConnector={(name, credId) => void testConnector(name, credId)}
        onToggleLinking={setLinkingConnector}
        onLink={(name, credId, credName) => void handleLink(name, credId, credName)}
        onAddCredential={handleAddCredential}
        onClearLinkError={clearLinkError}
        onSwap={handleSwap}
        healthFilter={healthFilter}
        onHealthFilterChange={setHealthFilter}
      />
      {designInstruction !== null && (
        <div className="border border-violet-500/20 rounded-modal overflow-hidden">
          <CredentialDesignModal
            open
            embedded
            initialInstruction={designInstruction}
            onClose={() => setDesignInstruction(null)}
            onComplete={handleDesignComplete}
          />
        </div>
      )}
    </div>
  );
}
