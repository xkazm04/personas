import { useState, useCallback, useEffect } from 'react';
import { Play, Wand2, Loader2, Save, Check } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVaultStore } from "@/stores/vaultStore";
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { useQueryDebug } from '@/hooks/database/useQueryDebug';
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

  const handleExecute = useCallback(async () => {
    if (!editorValue.trim()) return;
    setExecuting(true); setError(null); setResult(null);
    try {
      const res = await executeDbQuery(credentialId, editorValue, selectedId ?? undefined);
      setResult(res);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setExecuting(false);
    }
  }, [credentialId, editorValue, executeDbQuery, selectedId]);

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
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25 shadow-sm shadow-emerald-500/10'
              : saveState === 'saving'
                ? 'text-muted-foreground/40 border-transparent'
                : 'text-muted-foreground/50 hover:text-foreground/70 hover:bg-secondary/40 border-transparent hover:border-primary/10'
          }`}
        >
          {saveState === 'saved' ? <Check className="w-3 h-3" /> : saveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving...' : 'Save'}
        </button>

        <button
          onClick={handleExecute}
          disabled={executing || !editorValue.trim()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          {executing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {executing ? 'Running...' : 'Run'}
        </button>

        <button
          onClick={handleAiRun}
          disabled={queryDebug.isRunning || !editorValue.trim()}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 text-violet-400 border border-violet-500/20 hover:from-violet-500/25 hover:to-fuchsia-500/20 hover:border-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shadow-violet-500/5"
        >
          {queryDebug.isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
          {queryDebug.isRunning ? 'Debugging...' : 'AI Run'}
        </button>
      </div>

      {/* AI Debug TerminalStrip */}
      <AnimatePresence>
        {showTerminal && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
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
          </motion.div>
        )}
      </AnimatePresence>

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
        <AnimatePresence mode="wait">
          {error && (
            <motion.div key="error" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
              className="p-3 rounded-xl bg-red-500/8 border border-red-500/15 text-sm text-red-400/90 whitespace-pre-wrap font-mono leading-relaxed"
            >
              {error}
            </motion.div>
          )}
          {result && (
            <motion.div key="result" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
              <QueryResultTable result={result} />
            </motion.div>
          )}
          {!result && !error && !executing && (
            <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center pt-8">
              <p className="text-sm text-muted-foreground/25">
                {language === 'redis' ? 'Enter a Redis command and press Run or Ctrl+Enter' : 'Write a query and press Run or Ctrl+Enter'}
              </p>
            </motion.div>
          )}
          {executing && (
            <motion.div key="executing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center pt-8 gap-2">
              <span className="relative flex h-3 w-3 items-center justify-center">
                <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-40" />
                <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              <span className="text-sm text-muted-foreground/60">Executing query...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
