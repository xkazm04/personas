import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Wrench, ListChecks, ChevronDown, ChevronRight } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { DraftEditStep, type DraftEditTab } from '@/features/shared/components/editors/draft-editor';
import { ExecutionTerminal } from '@/features/agents/sub_executions';
import { N8nEntitiesTab } from '../edit/N8nEntitiesTab';
import { N8nUseCasesTab } from '../edit/N8nUseCasesTab';
import { useN8nDesignData } from '../hooks/useN8nDesignData';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';

/** Shallow-compare two objects by own enumerable keys. */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

interface N8nEditStepProps {
  draft: N8nPersonaDraft;
  draftJson: string;
  draftJsonError: string | null;
  parsedResult: AgentIR;
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
  const { t } = useTranslation();
  // Stabilise draft reference: only update when a field actually changes
  // (shallow comparison) so that memos depending on stableDraft don't
  // re-compute on every keystroke that creates a new object wrapper.
  const stableDraftRef = useRef(draft);
  if (!shallowEqual(stableDraftRef.current as unknown as Record<string, unknown>, draft as unknown as Record<string, unknown>)) {
    stableDraftRef.current = draft;
  }
  const stableDraft = stableDraftRef.current;

  // Track manually linked credentials so they survive tab switches (component remounts)
  const [manualLinks, setManualLinks] = useState<Record<string, { id: string; name: string }>>({});
  const [connectorsMissing, setConnectorsMissing] = useState(0);

  // Initialize manualLinks from persisted credential_links in design_context
  const credentials = useVaultStore((s) => s.credentials);
  const { credentialLinks } = useN8nDesignData(draft.design_context, draft.system_prompt, draft.structured_prompt as Record<string, unknown> | null);
  useEffect(() => {
    if (Object.keys(credentialLinks).length > 0) {
      const links: Record<string, { id: string; name: string }> = {};
      for (const [connName, credId] of Object.entries(credentialLinks)) {
        const cred = credentials.find((c) => c.id === credId);
        if (cred) {
          links[connName] = { id: cred.id, name: cred.name };
        }
      }
      if (Object.keys(links).length > 0) {
        setManualLinks((prev) => (Object.keys(prev).length > 0 ? prev : links));
      }
    }
  }, [credentialLinks, credentials]);

  const handleConnectorLink = useCallback((connectorName: string, credentialId: string, credentialName: string) => {
    setManualLinks((prev) => ({ ...prev, [connectorName]: { id: credentialId, name: credentialName } }));
  }, []);

  const handleMissingCountChange = useCallback((count: number) => {
    setConnectorsMissing(count);
    onConnectorsMissingChange?.(count);
  }, [onConnectorsMissingChange]);

  // Use Cases tab -- inserted after Identity
  const earlyTabs: DraftEditTab[] = useMemo(() => [
    {
      id: 'use-cases',
      label: t.templates.n8n.use_cases_tab,
      Icon: ListChecks,
      content: (
        <N8nUseCasesTab
          draft={stableDraft}
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
  ], [stableDraft, adjustmentRequest, transforming, disabled, onAdjustmentChange, onApplyAdjustment, onTestUseCase, testingUseCaseId]);

  // Orange dot badge for connectors tab when action is needed
  const connectorsBadge = connectorsMissing > 0 ? (
    <span className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
  ) : null;

  // N8n-specific tabs: entities (tools+connectors+triggers) -- inserted after Settings
  const additionalTabs: DraftEditTab[] = useMemo(() => [
    {
      id: 'entities',
      label: t.templates.n8n.tools_and_connectors_tab,
      Icon: Wrench,
      badge: connectorsBadge,
      content: (
        <N8nEntitiesTab
          draft={stableDraft}
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
  ], [stableDraft, parsedResult, selectedToolIndices, selectedTriggerIndices, selectedConnectorNames, onGoToAnalyze, connectorsBadge, manualLinks, handleConnectorLink, handleMissingCountChange, updateDraft]);

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

      {/* Test output panel -- below editor so user can see test CLI log */}
      {showTestPanel && (
        <div className="flex-shrink-0 mt-4 border-t border-primary/10" role="region" aria-label="Test output" aria-busy={testPhase === 'running'}>
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

          <AnimatePresence initial={false}>
            {testPanelOpen && (
              <motion.div
                key="test-panel-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <ExecutionTerminal
                  lines={testLines}
                  isRunning={testPhase === 'running'}
                  label={testRunId ? `test:${testRunId.slice(0, 8)}` : undefined}
                  terminalHeight={200}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
