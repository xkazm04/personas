import { useMemo, useState, useCallback, useEffect } from 'react';
import { Wrench, Link, ListChecks, FlaskConical } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { DraftEditStep, type DraftEditTab } from '@/features/shared/components/draft-editor';
import { ExecutionTerminal } from '@/features/agents/sub_executions/ExecutionTerminal';
import { N8nToolsPreviewTab } from './edit/N8nToolsPreviewTab';
import { N8nConnectorsTab } from './edit/N8nConnectorsTab';
import { N8nUseCasesTab } from './edit/N8nUseCasesTab';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { usePersonaStore } from '@/stores/personaStore';

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
  /** Test output streaming state */
  testPhase?: CliRunPhase;
  testLines?: string[];
  testRunId?: string | null;
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
  testPhase = 'idle',
  testLines = [],
  testRunId,
}: N8nEditStepProps) {
  // Track manually linked credentials so they survive tab switches (component remounts)
  const [manualLinks, setManualLinks] = useState<Record<string, { id: string; name: string }>>({});
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  // Initialize manualLinks from persisted credential_links in design_context
  const credentials = usePersonaStore((s) => s.credentials);
  useEffect(() => {
    const data = parseDesignContext(draft.design_context);
    if (data.credential_links && Object.keys(data.credential_links).length > 0) {
      const links: Record<string, { id: string; name: string }> = {};
      for (const [connName, credId] of Object.entries(data.credential_links)) {
        const cred = credentials.find((c) => c.id === credId);
        if (cred) {
          links[connName] = { id: cred.id, name: cred.name };
        }
      }
      if (Object.keys(links).length > 0) {
        setManualLinks((prev) => (Object.keys(prev).length > 0 ? prev : links));
      }
    }
  }, [draft.design_context, credentials]);

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

  // Test badge — green dot when passed, red when failed
  const testBadge = testPhase === 'completed' ? (
    <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
  ) : testPhase === 'failed' ? (
    <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
  ) : testPhase === 'running' ? (
    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
  ) : null;

  // N8n-specific tabs: tools + connectors + test — inserted after Settings
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
          updateDraft={updateDraft}
          manualLinks={manualLinks}
          onLink={handleConnectorLink}
          onMissingCountChange={handleMissingCountChange}
        />
      ),
    },
    {
      id: 'test',
      label: 'Test Output',
      Icon: FlaskConical,
      badge: testBadge,
      content: (
        <ExecutionTerminal
          lines={testLines}
          isRunning={testPhase === 'running'}
          label={testRunId ? `test:${testRunId.slice(0, 8)}` : undefined}
          terminalHeight={350}
        />
      ),
    },
  ], [draft, parsedResult, selectedToolIndices, selectedTriggerIndices, selectedConnectorNames, onGoToAnalyze, connectorsBadge, manualLinks, handleConnectorLink, handleMissingCountChange, updateDraft, testPhase, testLines, testRunId, testBadge]);

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
