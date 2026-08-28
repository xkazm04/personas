import { EngineCapabilityBadge } from '@/features/settings/sub_engine/components/EngineCapabilityBadge';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { SqlEditor } from '../SqlEditor';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { useQueryDebug } from '@/hooks/database/useQueryDebug';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { useDbQueryRunner } from '../hooks/useDbQueryRunner';
import { ResultsTable } from './ResultsTable';
import { QueryToolbar } from './QueryToolbar';
import { MutationConfirmBanner } from './MutationConfirmBanner';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const db = t.vault.databases;

  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  // The 'saved' badge reverts on a timer; the handle is kept so unmounting the
  // pane (switching saved query, leaving the tab) cannot fire setState on a
  // dead component.
  const savedResetRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(savedResetRef.current), []);
  const queryDebug = useQueryDebug();

  const { executing, result, error, setResult, setError, runQuery, cancelQuery } = useDbQueryRunner(
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
      // The store reports its own failures (toast + store error) and therefore
      // never rejects, so the catch below could not see a failed save: the green
      // "Saved" tick was painted next to the red toast for the same save. The
      // boolean is the only signal that the write actually landed.
      const ok = await updateQuery(selectedId, { queryText: editorValue });
      if (!ok) {
        setSaveState('idle');
        return;
      }
      setSaveState('saved');
      clearTimeout(savedResetRef.current);
      savedResetRef.current = setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      // Belt-and-braces for a throw the store does not currently produce.
      setSaveState('idle');
      toastCatch('QueryEditorPane:handleSave')(err);
    }
  }, [selectedId, editorValue, updateQuery, saveState]);

  const handleCancel = cancelQuery;

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
          pendingMutation={pendingMutation}
          hint={db.modifies_data_hint_short}
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
          placeholder={
            language === 'redis'
              ? db.redis_placeholder
              : language === 'convex'
                ? db.convex_placeholder
                : db.sql_placeholder
          }
          onExecute={handleExecute}
          minHeight="160px"
        />
      </div>

      {/* Results */}
      <ResultsTable result={result} error={error} executing={executing} language={language} />
    </>
  );
}
