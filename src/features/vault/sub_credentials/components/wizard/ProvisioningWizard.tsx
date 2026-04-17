import { useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';
import { useVaultStore } from "@/stores/vaultStore";
import { WizardDetectPhase } from './WizardDetectPhase';
import { WizardBatchPhase } from './WizardBatchPhase';
import { cancelAutoCredBrowser } from '@/api/vault/autoCredBrowser';
import { silentCatch } from "@/lib/silentCatch";
import type { ConnectorDefinition } from '@/lib/types/types';

interface ProvisioningWizardProps {
  onClose: () => void;
}

/**
 * Inline provisioning wizard panel -- rendered inside CredentialManager
 * instead of as a modal overlay, so progress is never lost on accidental close.
 */
export function ProvisioningWizard({ onClose }: ProvisioningWizardProps) {
  const phase = useProvisioningWizardStore((s) => s.phase);
  const selectedConnectors = useProvisioningWizardStore((s) => s.selectedConnectors);
  const selectConnectors = useProvisioningWizardStore((s) => s.selectConnectors);
  const back = useProvisioningWizardStore((s) => s.back);
  const close = useProvisioningWizardStore((s) => s.close);

  const open = useProvisioningWizardStore((s) => s.open);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);

  // Auto-open the wizard store when the component mounts with store still closed
  // (happens when user navigates via FSM rather than the store's open())
  useEffect(() => {
    if (phase === 'closed') {
      open();
    }
  }, []);

  // Track whether batch phase has a running session for cleanup
  const batchActiveRef = useRef(false);

  useEffect(() => {
    batchActiveRef.current = phase === 'batch';
  }, [phase]);

  const handleSelect = useCallback(
    (connectors: ConnectorDefinition[]) => {
      selectConnectors(connectors);
    },
    [selectConnectors],
  );

  const handleBack = useCallback(() => {
    // If going back from batch, cancel any running session
    if (batchActiveRef.current) {
      cancelAutoCredBrowser().catch(silentCatch("ProvisioningWizard:cancelBrowserOnBack"));
    }
    back();
  }, [back]);

  const handleClose = useCallback(() => {
    // Cancel any running session before closing
    if (batchActiveRef.current) {
      cancelAutoCredBrowser().catch(silentCatch("ProvisioningWizard:cancelBrowserOnClose"));
    }
    close();
    onClose();
  }, [close, onClose]);

  const handleBatchDone = useCallback(() => {
    void fetchCredentials();
    void fetchConnectorDefinitions();
    close();
    onClose();
  }, [fetchCredentials, fetchConnectorDefinitions, close, onClose]);

  if (phase === 'closed') return null;

  const subtitle =
    phase === 'batch'
      ? `Setting up ${selectedConnectors.length} service${selectedConnectors.length !== 1 ? 's' : ''}`
      : 'AI-guided credential setup';

  return (
    <div
      key="wizard-inline"
      data-testid="vault-wizard-container"
      className="animate-fade-slide-in bg-secondary/35 border border-primary/15 rounded-modal overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <button
            onClick={phase === 'batch' ? handleBack : handleClose}
            data-testid={phase === 'batch' ? 'vault-wizard-next' : 'vault-wizard-cancel'}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-modal bg-violet-500/15 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">
              Credential Setup Wizard
            </h2>
            <p className="text-xs text-foreground">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        {phase === 'detect' && (
            <div className="animate-fade-slide-in"
              key="wizard-detect"
            >
              <WizardDetectPhase onSelect={handleSelect} />
            </div>
          )}

          {phase === 'batch' && (
            <div className="animate-fade-slide-in"
              key="wizard-batch"
            >
              <WizardBatchPhase
                connectors={selectedConnectors}
                onDone={handleBatchDone}
              />
            </div>
          )}
      </div>
    </div>
  );
}
