/**
 * InlineCredentialPanel -- credential creation panel in ConnectStep.
 *
 * Two top-level methods:
 *   1. Manual Input   -- fill in known credential fields yourself
 *   2. Design with AI -- CLI analyzes a service and discovers credential fields
 *
 * Auto-Setup (Playwright) is offered *after* Design with AI completes, when
 * the LLM has identified setup procedures for the service.
 *
 * State machine: pick -> (design-query -> designing ->) manual <-> auto
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useCredentialDesign, type CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import { AutoCredPanel } from '@/features/vault/sub_autoCred/steps/AutoCredPanel';
import { useVaultStore } from "@/stores/vaultStore";
import { AnalyzingPhase } from '@/features/vault/sub_design/phases/AnalyzingPhase';
import { useTemplateMotion } from '@/features/templates/animationPresets';

import type { PanelMode, InlineCredentialPanelProps } from './inlineCredentialHelpers';
import { findConnectorDefinition, buildSyntheticDesignResult } from './inlineCredentialHelpers';
import { MethodPicker, DesignQueryInput, ManualForm } from './InlineCredentialSubPanels';

// -- Main Component -----------------------------------------------------

export function InlineCredentialPanel({
  connectorName,
  connectorDefinitions,
  credentialFields,
  setupUrl,
  setupInstructions,
  initialMode = 'pick',
  onSetCredential,
  onCredentialCreated,
  onSaveSuccess,
  onClose,
}: InlineCredentialPanelProps) {
  const { motion: MOTION } = useTemplateMotion();
  const meta = getConnectorMeta(connectorName);
  const connectorDef = useMemo(
    () => findConnectorDefinition(connectorName, connectorDefinitions),
    [connectorName, connectorDefinitions],
  );

  const [mode, setMode] = useState<PanelMode>(initialMode);
  const [designQuery, setDesignQuery] = useState(meta.label);
  const [activeDesignResult, setActiveDesignResult] = useState<CredentialDesignResult | null>(null);

  const design = useCredentialDesign();
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);

  // Synthetic result from known connector fields
  const syntheticResult = useMemo(
    () => buildSyntheticDesignResult(connectorName, connectorDef, credentialFields, setupInstructions),
    [connectorName, connectorDef, credentialFields, setupInstructions],
  );

  const hasKnownFields = !!syntheticResult;

  // When design completes, always go to manual (auto is reached from there)
  useEffect(() => {
    if (mode === 'designing' && design.phase === 'preview' && design.result) {
      setActiveDesignResult(design.result);
      setMode('manual');
    }
  }, [mode, design.phase, design.result]);

  // -- Method handlers --

  const handlePickManual = useCallback(() => {
    setMode('manual');
  }, []);

  const handlePickDesign = useCallback(() => {
    setMode('design-query');
  }, []);

  const handleStartDesign = useCallback(() => {
    if (!designQuery.trim()) return;
    design.start(designQuery.trim());
    setMode('designing');
  }, [designQuery, design]);

  const handleBack = useCallback(() => {
    if (mode === 'designing') {
      design.cancel();
    }
    design.reset();
    setActiveDesignResult(null);
    setMode(initialMode);
  }, [mode, design, initialMode]);

  // -- Switch to auto-setup from manual form --

  const handleSwitchToAuto = useCallback(() => {
    if (activeDesignResult) {
      setMode('auto');
    }
  }, [activeDesignResult]);

  // -- Auto-complete handler --

  const handleAutoComplete = useCallback(() => {
    // Credential already saved by useAutoCredSession -- refresh and map
    void fetchCredentials().then(() => {
      const creds = useVaultStore.getState().credentials;
      const match = creds
        .filter((c) => c.service_type === connectorName)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (match) {
        onSetCredential(connectorName, match.id);
        onSaveSuccess?.(connectorName, match.name);
      }
      onCredentialCreated();
      onClose();
    });
  }, [connectorName, fetchCredentials, onSetCredential, onCredentialCreated, onSaveSuccess, onClose]);

  const handleAutoCancel = useCallback(() => {
    // Go back to manual form (not all the way to pick)
    setMode('manual');
  }, []);

  return (
    <div
      className="animate-fade-slide-in overflow-hidden"
    >
      <div className="rounded-xl border border-primary/15 bg-secondary/20 p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode !== 'pick' && mode !== initialMode && (
              <Button
                variant="ghost"
                size="icon-sm"
                icon={<ArrowLeft className="w-4 h-4" />}
                onClick={handleBack}
                className="text-muted-foreground/60"
              />
            )}
            <ConnectorIcon meta={meta} size="w-4 h-4" />
            <span className="text-sm font-medium text-foreground/80">
              {initialMode === 'design-query' ? 'Custom Connector' : `New ${meta.label} Credential`}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            Cancel
          </Button>
        </div>

        {mode === 'pick' && (
            <MethodPicker
              key="pick"
              hasKnownFields={hasKnownFields}
              onManual={handlePickManual}
              onDesign={handlePickDesign}
            />
          )}

          {mode === 'design-query' && (
            <DesignQueryInput
              key="design-query"
              query={designQuery}
              onQueryChange={setDesignQuery}
              onStartDesign={handleStartDesign}
            />
          )}

          {mode === 'designing' && (
            <div className="animate-fade-slide-in"
              key="designing"
            >
              <AnalyzingPhase outputLines={design.outputLines} onCancel={handleBack} />
            </div>
          )}

          {mode === 'manual' && (
            <ManualForm
              key="manual"
              connectorName={connectorName}
              connectorDef={connectorDef}
              credentialFields={credentialFields}
              setupUrl={setupUrl}
              setupInstructions={setupInstructions}
              designResult={activeDesignResult}
              onSetCredential={onSetCredential}
              onCredentialCreated={onCredentialCreated}
              onSaveSuccess={onSaveSuccess}
              onClose={onClose}
              onSwitchToAuto={activeDesignResult ? handleSwitchToAuto : undefined}
            />
          )}

          {mode === 'auto' && activeDesignResult && (
            <div className="animate-fade-slide-in"
              key="auto"
            >
              <AutoCredPanel
                designResult={activeDesignResult}
                onComplete={handleAutoComplete}
                onCancel={handleAutoCancel}
              />
            </div>
          )}
      </div>
    </div>
  );
}
