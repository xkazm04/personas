import { useMemo, useState, useCallback } from 'react';
import { Plug } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ConnectorsSection } from '@/features/templates/sub_generated/design-preview/ConnectorsSection';
import { useTranslation } from '@/i18n/useTranslation';
import { useSavedDesignResult } from '../libs/designStateHelpers';
import { ConnectorVerificationPanel } from '@/features/agents/sub_connectors/components/connectors/ConnectorVerificationPanel';
import { useConnectorStatuses } from '@/features/agents/sub_connectors/libs/useConnectorStatuses';
import { CredentialDesignModal } from '@/features/vault/sub_catalog/components/design/CredentialDesignModal';
import { toastCatch } from '@/lib/silentCatch';

/**
 * The Design hub's Connectors sub-tab — the one section panel that survived
 * the agent-manifest collapse (2026-09-04). Its four former siblings
 * (Parameters, Events & Triggers, Notifications, and the read-only Properties
 * recap) were views onto a saved BUILD RESULT rather than onto the agent, and
 * the four-tab hub keeps only surfaces the agent itself owns.
 */

const NOOP = () => {};

/**
 * Connectors & Tools. Live connector verification (test / link / swap) via
 * `ConnectorVerificationPanel`, plus a read-only view of the connectors and
 * tools the original build proposed.
 *
 * The read-only design section was previously the whole panel, which meant the
 * sub-tab a user opens to check their connectors could only ever report what
 * the *build* suggested — never whether a linked credential actually works, and
 * nothing at all for a persona that was never designed.
 */
export function DesignConnectorsPanel() {
  const { t } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const toolDefinitions = useAgentStore((s) => s.toolDefinitions);
  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const saved = useSavedDesignResult(selectedPersona);
  const selectedTools = useMemo(() => new Set(saved?.suggested_tools ?? []), [saved]);
  // Connector name whose credential is being provisioned from the recap.
  const [provisioning, setProvisioning] = useState<string | null>(null);
  // ONE verification instance, shared by the live panel and the recap below, so
  // the two halves cannot disagree about a connector or double-test it.
  const verification = useConnectorStatuses();
  const [testingFromRecap, setTestingFromRecap] = useState<ReadonlySet<string>>(() => new Set());
  // Connectors the live panel already renders. Showing them again in the recap
  // would put two different notions of the same connector's health on screen.
  const liveConnectors = useMemo(
    () => new Set(verification.requiredCredTypes),
    [verification.requiredCredTypes],
  );

  const testFromRecap = useCallback(async (connectorName: string, credentialId: string) => {
    setTestingFromRecap((prev) => new Set(prev).add(connectorName));
    try {
      await verification.testConnector(connectorName, credentialId);
    } finally {
      setTestingFromRecap((prev) => {
        const next = new Set(prev);
        next.delete(connectorName);
        return next;
      });
    }
  }, [verification]);

  // The persona's live connectors come from its tools, not from a saved design,
  // so the verification panel stands on its own; only the design recap below
  // needs a saved result. The empty state is reserved for when neither exists.
  const hasLiveConnectors = selectedPersona?.tools.some((tool) => tool.requires_credential_type) ?? false;
  const designIsEmpty =
    !saved ||
    ((saved.suggested_connectors?.length ?? 0) === 0 && (saved.suggested_tools?.length ?? 0) === 0);
  if (designIsEmpty && !hasLiveConnectors) {
    return <SectionEmpty icon={Plug} title={t.agents.design_subtabs.connectors} />;
  }

  return (
    <div className="space-y-6">
      <ConnectorVerificationPanel verification={verification} />
      {!designIsEmpty && saved && (
        <>
          <ConnectorsSection
            result={saved}
            allToolDefs={toolDefinitions}
            currentToolNames={[]}
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            selectedTools={selectedTools}
            onToolToggle={NOOP}
            onConnectorClick={(connector) => setProvisioning(connector.name)}
            hiddenConnectors={liveConnectors}
            onTestConnector={(name, credId) => void testFromRecap(name, credId)}
            testingConnectors={testingFromRecap}
            readOnly
          />
          {provisioning !== null && (
            <div className="border border-violet-500/20 rounded-modal overflow-hidden">
              <CredentialDesignModal
                open
                embedded
                initialInstruction={`${provisioning} API credential`}
                onClose={() => setProvisioning(null)}
                onComplete={() => {
                  setProvisioning(null);
                  void fetchCredentials().catch(
                    toastCatch('DesignConnectorsPanel:fetchCredentialsOnDesignComplete', 'Failed to refresh credentials after setup'),
                  );
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionEmpty({ icon, title }: { icon: typeof Plug; title: string }) {
  return (
    <div className="py-12">
      <EmptyState icon={icon} title={title} />
    </div>
  );
}
