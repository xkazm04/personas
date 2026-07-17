import { EngineCapabilityBadge } from '@/features/settings/sub_engine/components/EngineCapabilityBadge';
import { useState, useCallback, useEffect } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';
import { SqlEditor } from '../SqlEditor';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { useQueryDebug } from '@/hooks/database/useQueryDebug';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { useDbQueryRunner } from '../hooks/useDbQueryRunner';
import { ResultsTable } from './ResultsTable';
import { QueryToolbar } from './QueryToolbar';
import { MutationConfirmBanner } from './MutationConfirmBanner';
import { toastCatch } from '@/lib/silentCatch';

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
  const { t } = useTranslation();
  const db = t.vault.databases;
  const updateQuery = useVaultStore((s) => s.updateDbSavedQuery);

  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const queryDebug = useQueryDebug();

  const { executing, result, error, setResult, setError, runQuery } = useDbQueryRunner(
    credentialId,
    selectedId ?? undefined,
  );

  useEffect(() => {
    if (queryDebug.result) { setResult(queryDebug.result); setError(null); }
  }, [queryDebug.result, setResult, setError]);

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
    } catch (err) {
      // Surface the failure — previously this silently reset the button to
      // idle, which reads identically to a successful save and led users to
      // believe an edit persisted when it didn't.
      setSaveState('idle');
      toastCatch('QueryEditorPane:handleSave')(err);
    }
  }, [selectedId, editorValue, updateQuery, saveState]);

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
        saveState={saveState}
        executing={executing}
        editorValue={editorValue}
        isAiRunning={queryDebug.isRunning}
        safeMode={safeMode}
        onSave={handleSave}
        onExecute={handleExecute}
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
          pendingMutation={pendingMutation}
          hint={db.modifies_data_hint_short}
          onConfirm={handleConfirmMutation}
          onCancel={handleCancelMutation}
          className="mx-4 mt-2 p-3 rounded-modal bg-amber-500/8 border border-amber-500/20 space-y-2.5"
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
