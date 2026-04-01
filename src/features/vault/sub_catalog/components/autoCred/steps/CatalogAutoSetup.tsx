import { useCallback, useState, useEffect, useRef } from 'react';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { useCredentialDesign } from '@/hooks/design/credential/useCredentialDesign';
import { AutoCredPanel } from './AutoCredPanel';
import { AnalyzingPhase } from '@/features/vault/sub_catalog/components/design/phases/AnalyzingPhase';
import { useVaultStore } from "@/stores/vaultStore";
import { checkPlaywrightAvailable } from '@/api/vault/autoCredBrowser';
import { isDesktopBridge } from '@/lib/utils/platform/connectors';
import { lookupRecipeAsDesignResult } from '@/lib/credentials/credentialRecipeRegistry';
import type { AutoCredMode } from '../helpers/types';
import { DesktopBridgeBlock, SetupHeader } from './SetupSteps';

type Phase = 'analyzing' | 'auto';

interface CatalogAutoSetupProps {
  connector: ConnectorDefinition;
  onComplete: () => void;
  onCancel: () => void;
}

/** Build a synthetic CredentialDesignResult from a catalog ConnectorDefinition. */
function buildDesignResult(connector: ConnectorDefinition): CredentialDesignResult {
  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  const setupInstructions =
    typeof metadata.setup_instructions === 'string' ? metadata.setup_instructions : '';

  return {
    match_existing: connector.name,
    connector: {
      name: connector.name,
      label: connector.label,
      category: connector.category,
      color: connector.color,
      fields: (connector.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        placeholder: f.placeholder,
        helpText: f.helpText,
      })),
      healthcheck_config: connector.healthcheck_config ?? null,
      services: [],
      events: [],
    },
    setup_instructions: setupInstructions,
    summary: `${connector.label} credential`,
  };
}

export function CatalogAutoSetup({ connector, onComplete, onCancel }: CatalogAutoSetupProps) {
  // Desktop bridge connectors should not use online auto-setup
  if (isDesktopBridge(connector)) {
    return <DesktopBridgeBlock connector={connector} onCancel={onCancel} />;
  }

  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  const hasSetupInstructions = typeof metadata.setup_instructions === 'string' && metadata.setup_instructions.length > 0;
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  const [phase, setPhase] = useState<Phase>(hasSetupInstructions ? 'auto' : 'analyzing');
  const [designResult, setDesignResult] = useState<CredentialDesignResult | null>(
    hasSetupInstructions ? buildDesignResult(connector) : null,
  );

  const [mode, setMode] = useState<AutoCredMode>('playwright');

  useEffect(() => {
    checkPlaywrightAvailable()
      .then((available) => setMode(available ? 'playwright' : 'guided'))
      .catch(() => setMode('guided'));
  }, []);

  const design = useCredentialDesign();
  const recipeLookedUpRef = useRef(false);

  useEffect(() => {
    if (phase !== 'analyzing' || design.phase !== 'idle') return;
    if (recipeLookedUpRef.current) {
      design.start(`Analyze ${connector.label} (${connector.name}) connector and discover setup procedures for creating API credentials.`);
      return;
    }
    recipeLookedUpRef.current = true;

    void lookupRecipeAsDesignResult(connector.name).then((cached) => {
      if (cached) {
        setDesignResult({ ...cached, match_existing: connector.name });
        setPhase('auto');
      } else {
        design.start(`Analyze ${connector.label} (${connector.name}) connector and discover setup procedures for creating API credentials.`);
      }
    });
  }, [phase]);

  useEffect(() => {
    if (phase === 'analyzing' && design.phase === 'preview' && design.result) {
      const merged: CredentialDesignResult = {
        ...design.result,
        match_existing: connector.name,
      };
      setDesignResult(merged);
      setPhase('auto');
    }
  }, [phase, design.phase, design.result, connector.name]);

  useEffect(() => {
    if (phase === 'analyzing' && design.phase === 'error') {
      setDesignResult(buildDesignResult(connector));
      setPhase('auto');
    }
  }, [phase, design.phase, connector]);

  const handleComplete = useCallback(() => {
    void fetchCredentials().then(() => onComplete());
  }, [fetchCredentials, onComplete]);

  const handleCancel = useCallback(() => {
    if (phase === 'analyzing') design.cancel();
    onCancel();
  }, [phase, design, onCancel]);

  return (
    <div
      key="auto-setup"
      className="animate-fade-slide-in bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-6 space-y-4"
    >
      <SetupHeader connector={connector} mode={mode} phase={phase} onCancel={handleCancel} />

      {phase === 'analyzing' && (
        <AnalyzingPhase outputLines={design.outputLines} onCancel={handleCancel} />
      )}

      {phase === 'auto' && designResult && (
        <AutoCredPanel
          designResult={designResult}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
