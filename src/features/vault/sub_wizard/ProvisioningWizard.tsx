import { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
    <motion.div
      key="wizard-inline"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-secondary/35 border border-primary/15 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
        <div className="flex items-center gap-3">
          <button
            onClick={phase === 'batch' ? handleBack : handleClose}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
            <Sparkles className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-foreground">
              Credential Setup Wizard
            </h2>
            <p className="text-xs text-muted-foreground/80">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        <AnimatePresence mode="wait">
          {phase === 'detect' && (
            <motion.div
              key="wizard-detect"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <WizardDetectPhase onSelect={handleSelect} />
            </motion.div>
          )}

          {phase === 'batch' && (
            <motion.div
              key="wizard-batch"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <WizardBatchPhase
                connectors={selectedConnectors}
                onDone={handleBatchDone}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
