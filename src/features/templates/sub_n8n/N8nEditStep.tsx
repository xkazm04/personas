import { useMemo, useState, useCallback, useEffect } from 'react';
import { Wrench, ListChecks, ChevronDown, ChevronRight } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { DraftEditStep, type DraftEditTab } from '@/features/shared/components/draft-editor';
import { ExecutionTerminal } from '@/features/agents/sub_executions/ExecutionTerminal';
import { N8nEntitiesTab } from './edit/N8nEntitiesTab';
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
  /** Called when the user clicks the test button on a use case */
  onTestUseCase?: (useCaseId: string, sampleInput?: Record<string, unknown>) => void;
  /** ID of the use case currently being tested */
  testingUseCaseId?: string | null;
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
  onTestUseCase,
  testingUseCaseId,
}: N8nEditStepProps) {
  // Track manually linked credentials so they survive tab switches (component remounts)
  const [manualLinks, setManualLinks] = useState<Record<string, { id: string; name: string }>>({});
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  // Initialize manualLinks from persisted credential_links in design_context
  const credentials = usePersonaStore((s) => s.credentials);
  useEffect(() => {
    const data = parseDesignContext(draft.design_context);
    if (data.credentialLinks && Object.keys(data.credentialLinks).length > 0) {
      const links: Record<string, { id: string; name: string }> = {};
      for (const [connName, credId] of Object.entries(data.credentialLinks)) {
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
          onTestUseCase={onTestUseCase}
          testingUseCaseId={testingUseCaseId}
        />
      ),
    },
  ], [draft, adjustmentRequest, transforming, disabled, onAdjustmentChange, onApplyAdjustment, onTestUseCase, testingUseCaseId]);

  // Orange dot badge for connectors tab when action is needed
  const connectorsBadge = connectorsMissing > 0 ? (
    <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
  ) : null;

  // N8n-specific tabs: entities (tools+connectors+triggers) — inserted after Settings
  const additionalTabs: DraftEditTab[] = useMemo(() => [
    {
      id: 'entities',
      label: 'Tools & Connectors',
      Icon: Wrench,
      badge: connectorsBadge,
      content: (
        <N8nEntitiesTab
          draft={draft}
          parsedResult={parsedResult}
          selectedToolIndices={selectedToolIndices}
          selectedTriggerIndices={selectedTriggerIndices}
          selectedConnectorNames={selectedConnectorNames}
          manualLinks={manualLinks}
          updateDraft={updateDraft}
          onLink={handleConnectorLink}
          onMissingCountChange={handleMissingCountChange}
          onGoToAnalyze={onGoToAnalyze}
        />
      ),
    },
  ], [draft, parsedResult, selectedToolIndices, selectedTriggerIndices, selectedConnectorNames, onGoToAnalyze, connectorsBadge, manualLinks, handleConnectorLink, handleMissingCountChange, updateDraft]);

  // Show test output panel when a test has been started
  const showTestPanel = testPhase !== 'idle' || testLines.length > 0;
  const [testPanelOpen, setTestPanelOpen] = useState(true);

  // Auto-open panel when test starts
  useEffect(() => {
    if (testPhase === 'running') setTestPanelOpen(true);
  }, [testPhase]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
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
      </div>

      {/* Test output panel — below editor so user can see test CLI log */}
      {showTestPanel && (
        <div className="flex-shrink-0 border-t border-primary/10">
          <button
            onClick={() => setTestPanelOpen((p) => !p)}
            className="flex items-center justify-between w-full px-4 py-2 bg-primary/5 hover:bg-secondary/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              {testPanelOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/70" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/70" />
              )}
              <span className="text-sm font-mono text-muted-foreground/80">
                Test Output
              </span>
              {testPhase === 'running' && (
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              )}
              {testPhase === 'completed' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
              {testPhase === 'failed' && (
                <span className="w-2 h-2 rounded-full bg-red-400" />
              )}
            </div>
            <span className="text-sm text-muted-foreground/60 font-mono">{testLines.length} lines</span>
          </button>

          {testPanelOpen && (
            <ExecutionTerminal
              lines={testLines}
              isRunning={testPhase === 'running'}
              label={testRunId ? `test:${testRunId.slice(0, 8)}` : undefined}
              terminalHeight={200}
            />
          )}
        </div>
      )}
    </div>
  );
}
