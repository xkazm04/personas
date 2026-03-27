import { useState, useCallback, useEffect } from 'react';
import { Play, Wand2, Save, Check, Shield, ShieldOff, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useVaultStore } from "@/stores/vaultStore";
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { useQueryDebug } from '@/hooks/database/useQueryDebug';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import type { QueryResult } from '@/api/vault/database/dbSchema';

/** Extract a human-readable error message from a Tauri IPC error. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'error' in err) {
    return String((err as Record<string, unknown>).error);
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { /* intentional: non-critical -- JSON stringify fallback */ return 'Unknown error'; }
}

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
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/8 bg-secondary/5 shrink-0">
        <span className="text-sm font-semibold text-foreground/70 flex-1 truncate">{selectedTitle}</span>
        <span className="text-sm uppercase tracking-wider text-muted-foreground/60 px-2 py-0.5 rounded-lg bg-secondary/40 border border-primary/8 font-medium">
          {language}
        </span>

        <button
          onClick={handleSave}
          disabled={saveState === 'saving'}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-all duration-300 ${
            saveState === 'saved'
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25 shadow-elevation-1 shadow-emerald-500/10'
              : saveState === 'saving'
                ? 'text-muted-foreground/40 border-transparent'
                : 'text-muted-foreground/50 hover:text-foreground/70 hover:bg-secondary/40 border-transparent hover:border-primary/10'
          }`}
        >
          {saveState === 'saved' ? <Check className="w-3 h-3" /> : saveState === 'saving' ? <LoadingSpinner size="xs" /> : <Save className="w-3 h-3" />}
          {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving...' : 'Save'}
        </button>

        <button
          onClick={handleExecute}
          disabled={executing || !editorValue.trim()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          {executing ? <LoadingSpinner size="xs" /> : <Play className="w-3 h-3" />}
          {executing ? 'Running...' : 'Run'}
        </button>

        <button
          onClick={handleAiRun}
          disabled={queryDebug.isRunning || !editorValue.trim()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 text-violet-400 border border-violet-500/20 hover:from-violet-500/25 hover:to-fuchsia-500/20 hover:border-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-elevation-1 shadow-violet-500/5"
        >
          {queryDebug.isRunning ? <LoadingSpinner size="xs" /> : <Wand2 className="w-3 h-3" />}
          {queryDebug.isRunning ? 'Debugging...' : 'AI Run'}
        </button>

        <button
          onClick={() => setSafeMode((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-all ${
            safeMode
              ? 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20 hover:bg-emerald-500/15'
              : 'bg-amber-500/8 text-amber-400/80 border-amber-500/20 hover:bg-amber-500/15'
          }`}
          title={safeMode ? 'Safe mode ON: write queries require confirmation' : 'Safe mode OFF: all queries execute directly'}
        >
          {safeMode ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
          {safeMode ? 'Safe' : 'Write'}
        </button>
      </div>

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
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {error && (
            <div key="error"
              className="animate-fade-slide-in p-3 rounded-xl bg-red-500/8 border border-red-500/15 text-sm text-red-400/90 whitespace-pre-wrap font-mono leading-relaxed"
            >
              {error}
            </div>
          )}
          {result && (
            <div className="animate-fade-slide-in" key="result">
              <QueryResultTable result={result} />
            </div>
          )}
          {!result && !error && !executing && (
            <div key="hint" className="animate-fade-slide-in flex items-center justify-center pt-8">
              <p className="text-sm text-muted-foreground/25">
                {language === 'redis' ? 'Enter a Redis command and press Run or Ctrl+Enter' : 'Write a query and press Run or Ctrl+Enter'}
              </p>
            </div>
          )}
          {executing && (
            <div key="executing" className="animate-fade-slide-in flex items-center justify-center pt-8 gap-2">
              <span className="relative flex h-3 w-3 items-center justify-center">
                <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-40" />
                <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              <span className="text-sm text-muted-foreground/60">Executing query...</span>
            </div>
          )}
      </div>
    </>
  );
}
