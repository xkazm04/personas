import { useMemo } from 'react';
import { Wrench, Link } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import { DraftEditStep, type DraftEditTab } from '@/features/shared/components/draft-editor';
import { N8nToolsPreviewTab } from './edit/N8nToolsPreviewTab';
import { N8nConnectorsTab } from './edit/N8nConnectorsTab';

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
}: N8nEditStepProps) {
  // N8n-specific tabs: tools + connectors
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
      content: (
        <N8nConnectorsTab draft={draft} />
      ),
    },
  ], [draft, parsedResult, selectedToolIndices, selectedTriggerIndices, selectedConnectorNames, onGoToAnalyze]);

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
      additionalTabs={additionalTabs}
    />
  );
}
