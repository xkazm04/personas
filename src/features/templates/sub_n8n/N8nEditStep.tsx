import { useMemo, useState, useCallback } from 'react';
import { Wrench, Link, ListChecks } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { DraftEditStep, type DraftEditTab } from '@/features/shared/components/draft-editor';
import { N8nToolsPreviewTab } from './edit/N8nToolsPreviewTab';
import { N8nConnectorsTab } from './edit/N8nConnectorsTab';
import { N8nUseCasesTab } from './edit/N8nUseCasesTab';

interface N8nEditStepProps {
  draft: N8nPersonaDraft;
  draftJson: string;
  draftJsonError: string | null;
  parsedResult: DesignAnalysisResult;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  adjustmentRequest: string;
  transforming: boolean;
  disabled: boolean;
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
  onDraftUpdated: (draft: N8nPersonaDraft) => void;
  onJsonEdited: (json: string, draft: N8nPersonaDraft | null, error: string | null) => void;
  onAdjustmentChange: (text: string) => void;
  onApplyAdjustment: () => void;
  onGoToAnalyze: () => void;
  /** Called when the number of unmapped connectors changes */
  onConnectorsMissingChange?: (count: number) => void;
}

export function N8nEditStep({
  draft,
  draftJson,
  draftJsonError,
  parsedResult,
  selectedToolIndices,
  selectedTriggerIndices,
  selectedConnectorNames,
  adjustmentRequest,
  transforming,
  disabled,
  updateDraft,
  onDraftUpdated,
  onJsonEdited,
  onAdjustmentChange,
  onApplyAdjustment,
  onGoToAnalyze,
  onConnectorsMissingChange,
}: N8nEditStepProps) {
  // Track manually linked credentials so they survive tab switches (component remounts)
  const [manualLinks, setManualLinks] = useState<Record<string, { id: string; name: string }>>({});
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  const handleConnectorLink = useCallback((connectorName: string, credentialId: string, credentialName: string) => {
    setManualLinks((prev) => ({ ...prev, [connectorName]: { id: credentialId, name: credentialName } }));
  }, []);

  const handleMissingCountChange = useCallback((count: number) => {
    setConnectorsMissing(count);
    onConnectorsMissingChange?.(count);
  }, [onConnectorsMissingChange]);

  // Use Cases tab — inserted after Identity
  const earlyTabs: DraftEditTab[] = useMemo(() => [
    {
      id: 'use-cases',
      label: 'Use Cases',
      Icon: ListChecks,
      content: (
        <N8nUseCasesTab
          draft={draft}
          adjustmentRequest={adjustmentRequest}
          transforming={transforming}
          disabled={disabled}
          onAdjustmentChange={onAdjustmentChange}
          onApplyAdjustment={onApplyAdjustment}
        />
      ),
    },
  ], [draft, adjustmentRequest, transforming, disabled, onAdjustmentChange, onApplyAdjustment]);

  // Orange dot badge for connectors tab when action is needed
  const connectorsBadge = connectorsMissing > 0 ? (
    <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
  ) : null;

  // N8n-specific tabs: tools + connectors — inserted after Settings
  const additionalTabs: DraftEditTab[] = useMemo(() => [
    {
      id: 'tools',
      label: 'Tools',
      Icon: Wrench,
      content: (
        <N8nToolsPreviewTab
          draft={draft}
          parsedResult={parsedResult}
          selectedToolIndices={selectedToolIndices}
          selectedTriggerIndices={selectedTriggerIndices}
          selectedConnectorNames={selectedConnectorNames}
          onGoToAnalyze={onGoToAnalyze}
        />
      ),
    },
    {
      id: 'connectors',
      label: 'Connectors',
      Icon: Link,
      badge: connectorsBadge,
      content: (
        <N8nConnectorsTab
          draft={draft}
          manualLinks={manualLinks}
          onLink={handleConnectorLink}
          onMissingCountChange={handleMissingCountChange}
        />
      ),
    },
  ], [draft, parsedResult, selectedToolIndices, selectedTriggerIndices, selectedConnectorNames, onGoToAnalyze, connectorsBadge, manualLinks, handleConnectorLink, handleMissingCountChange]);

  return (
    <DraftEditStep
      draft={draft}
      draftJson={draftJson}
      draftJsonError={draftJsonError}
      adjustmentRequest={adjustmentRequest}
      transforming={transforming}
      disabled={disabled}
      updateDraft={updateDraft}
      onDraftUpdated={onDraftUpdated}
      onJsonEdited={onJsonEdited}
      onAdjustmentChange={onAdjustmentChange}
      onApplyAdjustment={onApplyAdjustment}
      earlyTabs={earlyTabs}
      additionalTabs={additionalTabs}
      hideAdjustmentPanel
      showNotifications
    />
  );
}
