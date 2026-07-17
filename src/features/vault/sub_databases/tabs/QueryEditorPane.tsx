import { EngineCapabilityBadge } from '@/features/settings/sub_engine/components/EngineCapabilityBadge';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { SqlEditor } from '../SqlEditor';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { useQueryDebug } from '@/hooks/database/useQueryDebug';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { ResultsTable } from './ResultsTable';
import { QueryToolbar } from './QueryToolbar';
import { MutationConfirmBanner } from './MutationConfirmBanner';
import type { QueryResult } from '@/api/vault/database/dbSchema';
import { extractErrorMessage } from '../safeModeUtils';

interface QueryEditorPaneProps {
  credentialId: string;
  language: string;
  serviceType: string;
  selectedId: string | null;
  selectedTitle: string;
  editorValue: string;
  onEditorChange: (value: string) => void;
}

export function QueryEditorPane({
  credentialId,
  language,
  serviceType,
  selectedId,
  selectedTitle,
  editorValue,
  onEditorChange,
}: QueryEditorPaneProps) {
  const updateQuery = useVaultStore((s) => s.updateDbSavedQuery);
  const executeDbQuery = useVaultStore((s) => s.executeDbQuery);
  const cancelDbQuery = useVaultStore((s) => s.cancelDbQuery);
  const runningQueryId = useRef<string | null>(null);

  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const queryDebug = useQueryDebug();

  useEffect(() => {
    if (queryDebug.result) { setResult(queryDebug.result); setError(null); }
  }, [queryDebug.result]);

  useEffect(() => {
    if (queryDebug.correctedQuery) onEditorChange(queryDebug.correctedQuery);
  }, [queryDebug.correctedQuery, onEditorChange]);

  const handleSave = useCallback(async () => {
    if (!selectedId || saveState === 'saving') return;
    setSaveState('saving');
    try {
      await updateQuery(selectedId, { queryText: editorValue });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      setSaveState('idle');
    }
  }, [selectedId, editorValue, updateQuery, saveState]);

  const runQuery = useCallback(async (text: string, allowMutation: boolean) => {
    const queryId = crypto.randomUUID();
    runningQueryId.current = queryId;
    setExecuting(true); setError(null); setResult(null);
    try {
      const res = await executeDbQuery(credentialId, text, selectedId ?? undefined, allowMutation, queryId);
      setResult(res);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      if (runningQueryId.current === queryId) runningQueryId.current = null;
      setExecuting(false);
    }
  }, [credentialId, executeDbQuery, selectedId]);

  const handleCancel = useCallback(() => {
    const queryId = runningQueryId.current;
    if (queryId) void cancelDbQuery(queryId);
  }, [cancelDbQuery]);

  const { safeMode, setSafeMode, pendingMutation, guardedExecute, confirmMutation: handleConfirmMutation, cancelMutation: handleCancelMutation } = useQuerySafeMode(runQuery);

  const handleExecute = useCallback(async () => {
    if (!editorValue.trim()) return;
    await guardedExecute(editorValue);
  }, [editorValue, guardedExecute]);

  const handleAiRun = useCallback(async () => {
    if (!editorValue.trim()) return;
    setTerminalExpanded(false);
    await queryDebug.start(credentialId, editorValue, error, serviceType);
  }, [editorValue, queryDebug, credentialId, error, serviceType]);

  const showTerminal = queryDebug.phase !== 'idle';

  return (
    <>
      <QueryToolbar
        selectedTitle={selectedTitle}
        language={language}
        serviceType={serviceType}
        saveState={saveState}
        executing={executing}
        editorValue={editorValue}
        isAiRunning={queryDebug.isRunning}
        safeMode={safeMode}
        onSave={handleSave}
        onExecute={handleExecute}
        onCancel={handleCancel}
        onAiRun={handleAiRun}
        onToggleSafeMode={() => setSafeMode((v) => !v)}
      />

      {/* AI Debug TerminalStrip */}
      {showTerminal && (
          <div className="animate-fade-slide-in">
            <TerminalStrip
              lastLine={queryDebug.lastLine}
              lines={queryDebug.lines}
              isRunning={queryDebug.isRunning}
              isExpanded={terminalExpanded}
              onToggle={() => setTerminalExpanded((v) => !v)}
              onClear={queryDebug.clear}
              expandedMaxHeight="max-h-52"
              capabilityBadge={<EngineCapabilityBadge operation="query_debug" compact />}
            />
          </div>
        )}

      {/* Mutation confirmation dialog */}
      {pendingMutation && (
        <MutationConfirmBanner
          sql={pendingMutation}
          onConfirm={handleConfirmMutation}
          onCancel={handleCancelMutation}
        />
      )}

      {/* Editor */}
      <div className="px-4 pt-4 pb-2 shrink-0">
        <SqlEditor
          value={editorValue}
          onChange={onEditorChange}
          language={language}
          placeholder={language === 'redis' ? 'GET mykey' : language === 'convex' ? '{"path": "func:name", "args": {}}' : 'SELECT * FROM ...'}
          onExecute={handleExecute}
          minHeight="160px"
        />
      </div>

      {/* Results */}
      <ResultsTable result={result} error={error} executing={executing} language={language} />
    </>
  );
}
