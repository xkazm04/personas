import { useState, useEffect, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { mergeCredentialLink } from '@/features/shared/components/UseCasesList';
import { matchCredentialToConnector } from './connectorMatching';
import type { N8nPersonaDraft } from '@/api/n8nTransform';

// ── Types ────────────────────────────────────────────────────────────────

export interface ConnectorStatus {
  name: string;
  n8nType: string;
  credentialId: string | null;
  credentialName: string | null;
  hasConnectorDef: boolean;
  testing: boolean;
  result: { success: boolean; message: string } | null;
}

export const STATUS_CONFIG = {
  ready:    { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Ready' },
  untested: { color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',    label: 'Untested' },
  failed:   { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',     label: 'Failed' },
  missing:  { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20', label: 'No credential' },
  testing:  { color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',    label: 'Testing...' },
} as const;

export type StatusKey = keyof typeof STATUS_CONFIG;

export function getStatusKey(status: ConnectorStatus): StatusKey {
  if (status.testing) return 'testing';
  if (!status.credentialId) return 'missing';
  if (!status.result) return 'untested';
  return status.result.success ? 'ready' : 'failed';
}

export interface DraftConnector {
  name: string;
  n8n_credential_type: string;
  has_credential: boolean;
}

// ── Hook options ─────────────────────────────────────────────────────────

interface UseConnectorStatusesOptions {
  connectors: DraftConnector[];
  manualLinks?: Record<string, { id: string; name: string }>;
  updateDraft?: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
  onLink?: (connectorName: string, credentialId: string, credentialName: string) => void;
  onMissingCountChange?: (count: number) => void;
  onCredentialCreated?: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useConnectorStatuses({
  connectors,
  manualLinks,
  updateDraft,
  onLink,
  onMissingCountChange,
  onCredentialCreated,
}: UseConnectorStatusesOptions) {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const healthcheckCredential = usePersonaStore((s) => s.healthcheckCredential);

  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');
  const [testingAll, setTestingAll] = useState(false);
  const [linkingConnector, setLinkingConnector] = useState<string | null>(null);

  // Build connector statuses from draft + store data + manual links
  useEffect(() => {
    if (connectors.length === 0) {
      setStatuses([]);
      return;
    }
    setStatuses((prev) =>
      connectors.map((conn) => {
        const matchedCred = matchCredentialToConnector(credentials, conn.name);
        const matchedDef = connectorDefinitions.find((c) => c.name === conn.name);
        const existing = prev.find((p) => p.name === conn.name);
        const manual = manualLinks?.[conn.name];

        return {
          name: conn.name,
          n8nType: conn.n8n_credential_type,
          credentialId: existing?.credentialId ?? manual?.id ?? matchedCred?.id ?? null,
          credentialName: existing?.credentialName ?? manual?.name ?? matchedCred?.name ?? null,
          hasConnectorDef: !!matchedDef,
          testing: existing?.testing ?? false,
          result: existing?.result ?? null,
        };
      }),
    );
  }, [connectors, credentials, connectorDefinitions, manualLinks]);

  // Fetch credentials and connector definitions on mount
  useEffect(() => {
    void fetchCredentials().catch(() => {});
    void fetchConnectorDefinitions();
  }, [fetchCredentials, fetchConnectorDefinitions]);

  // Auto-test connectors that have a credential but no result yet
  const hasAutoTestedRef = useState<Set<string>>(() => new Set())[0];
  useEffect(() => {
    for (const status of statuses) {
      if (status.credentialId && !status.result && !status.testing && !hasAutoTestedRef.has(status.name)) {
        hasAutoTestedRef.add(status.name);
        void testConnector(status.name, status.credentialId);
      }
    }
  }, [statuses]);

  const testConnector = useCallback(async (connectorName: string, credentialId: string) => {
    setStatuses((prev) =>
      prev.map((s) => s.name === connectorName ? { ...s, testing: true, result: null } : s),
    );
    try {
      const result = await healthcheckCredential(credentialId);
      setStatuses((prev) =>
        prev.map((s) => s.name === connectorName ? { ...s, testing: false, result } : s),
      );
    } catch (err) {
      setStatuses((prev) =>
        prev.map((s) =>
          s.name === connectorName
            ? { ...s, testing: false, result: { success: false, message: err instanceof Error ? err.message : 'Healthcheck failed' } }
            : s,
        ),
      );
    }
  }, [healthcheckCredential]);

  const handleTestAll = useCallback(async () => {
    setTestingAll(true);
    for (const status of statuses.filter((s) => s.credentialId)) {
      await testConnector(status.name, status.credentialId!);
    }
    setTestingAll(false);
  }, [statuses, testConnector]);

  const handleAddCredential = useCallback((connectorName: string, n8nType: string) => {
    setLinkingConnector(null);
    setDesignInstruction(`${connectorName} API credential (n8n type: ${n8nType})`);
    setDesignOpen(true);
  }, []);

  const handleLinkCredential = useCallback((connectorName: string, credentialId: string, credentialName: string) => {
    setStatuses((prev) =>
      prev.map((s) =>
        s.name === connectorName ? { ...s, credentialId, credentialName, result: null } : s,
      ),
    );
    setLinkingConnector(null);
    onLink?.(connectorName, credentialId, credentialName);
    updateDraft?.((current) => ({
      ...current,
      design_context: mergeCredentialLink(current.design_context, connectorName, credentialId),
    }));
    void testConnector(connectorName, credentialId);
  }, [onLink, updateDraft, testConnector]);

  const handleDesignComplete = useCallback(() => {
    setDesignOpen(false);
    setDesignInstruction('');
    void fetchCredentials().catch(() => {});
    void fetchConnectorDefinitions();
    onCredentialCreated?.();
  }, [fetchCredentials, fetchConnectorDefinitions, onCredentialCreated]);

  const handleDesignClose = useCallback(() => {
    setDesignOpen(false);
    setDesignInstruction('');
  }, []);

  const missingCount = statuses.filter((s) => !s.credentialId).length;
  const readyCount = statuses.filter((s) => s.result?.success).length;
  const testableCount = statuses.filter((s) => s.credentialId).length;

  // Report missing count to parent
  useEffect(() => {
    onMissingCountChange?.(missingCount);
  }, [missingCount, onMissingCountChange]);

  return {
    statuses,
    testingAll,
    linkingConnector,
    setLinkingConnector,
    designOpen,
    designInstruction,
    missingCount,
    readyCount,
    testableCount,
    testConnector,
    handleTestAll,
    handleAddCredential,
    handleLinkCredential,
    handleDesignComplete,
    handleDesignClose,
  };
}
