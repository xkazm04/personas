import { useState, useCallback, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";
import { SqlEditor } from '../SqlEditor';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { useQueryDebug } from '@/hooks/database/useQueryDebug';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { ResultsTable } from './ResultsTable';
import { QueryToolbar } from './QueryToolbar';
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
    setExecuting(true); setError(null); setResult(null);
    try {
      const res = await executeDbQuery(credentialId, text, selectedId ?? undefined, allowMutation);
      setResult(res);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setExecuting(false);
    }
  }, [credentialId, executeDbQuery, selectedId]);

  const { safeMode, setSafeMode, pendingMutation, guardedExecute, confirmMutation: handleConfirmMutation, cancelMutation: handleCancelMutation } = useQuerySafeMode(runQuery);

  const handleExecute = useCallback(async () => {
    if (!editorValue.trim()) return;
    await guardedExecute(editorValue);
  }, [editorValue, guardedExecute]);

  const handleAiRun = useCallback(async () => {
    if (!editorValue.trim()) return;
    setTerminalExpanded(false);
    await queryDebug.start(credentialId, editorValue, error, serviceType);
  }, [credentialId, editorValue, error, serviceType, queryDebug.start]);

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
              operation="query_debug"
            />
          </div>
        )}

      {/* Mutation confirmation dialog */}
      {pendingMutation && (
        <div className="mx-4 mt-2 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium text-amber-300/90">This query modifies data</p>
              <p className="text-sm text-muted-foreground/60">
                The statement appears to be a write operation. Are you sure you want to execute it?
              </p>
              <pre className="text-sm font-mono text-muted-foreground/50 bg-secondary/30 rounded-lg px-2.5 py-1.5 overflow-x-auto max-h-20 border border-primary/5">
                {pendingMutation.length > 200 ? pendingMutation.slice(0, 200) + '...' : pendingMutation}
              </pre>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-6">
            <button
              onClick={handleConfirmMutation}
              className="px-3 py-1.5 rounded-xl text-sm font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
            >
              Execute Anyway
            </button>
            <button
              onClick={handleCancelMutation}
              className="px-3 py-1.5 rounded-xl text-sm font-medium text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/40 border border-transparent hover:border-primary/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
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
