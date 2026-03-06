import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Star, Play, Check, X, Wand2, Loader2, Save } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
import { TerminalStrip } from '@/features/shared/components/TerminalStrip';
import { useQueryDebug } from '@/hooks/database/useQueryDebug';
import type { QueryResult } from '@/api/dbSchema';

/** Extract a human-readable error message from a Tauri IPC error. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'error' in err) {
    return String((err as Record<string, unknown>).error);
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { /* intentional: non-critical -- JSON stringify fallback */ return 'Unknown error'; }
}

interface QueriesTabProps {
  credentialId: string;
  language: string;
  serviceType: string;
}

export function QueriesTab({ credentialId, language, serviceType }: QueriesTabProps) {
  const queries = usePersonaStore((s) => s.dbSavedQueries).filter((q) => q.credential_id === credentialId);
  const createQuery = usePersonaStore((s) => s.createDbSavedQuery);
  const updateQuery = usePersonaStore((s) => s.updateDbSavedQuery);
  const deleteQuery = usePersonaStore((s) => s.deleteDbSavedQuery);
  const executeDbQuery = usePersonaStore((s) => s.executeDbQuery);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const queryDebug = useQueryDebug();

  const selectedQuery = queries.find((q) => q.id === selectedId);

  // When AI debug completes with a result, show it
  useEffect(() => {
    if (queryDebug.result) {
      setResult(queryDebug.result);
      setError(null);
    }
  }, [queryDebug.result]);

  // When AI debug produces a corrected query, update the editor
  useEffect(() => {
    if (queryDebug.correctedQuery) {
      setEditorValue(queryDebug.correctedQuery);
    }
  }, [queryDebug.correctedQuery]);

  const handleSelect = useCallback((id: string) => {
    const q = queries.find((q) => q.id === id);
    if (q) {
      setSelectedId(id);
      setEditorValue(q.query_text);
      setResult(null);
      setError(null);
    }
  }, [queries]);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const q = await createQuery(credentialId, title, '', language);
    if (q) {
      setSelectedId(q.id);
      setEditorValue('');
      setIsCreating(false);
      setNewTitle('');
    }
  }, [credentialId, newTitle, language, createQuery]);

  const handleSave = useCallback(async () => {
    if (!selectedId || saveState === 'saving') return;
    setSaveState('saving');
    try {
      await updateQuery(selectedId, { queryText: editorValue });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch {
      // intentional: non-critical -- save failure resets state silently
      setSaveState('idle');
    }
  }, [selectedId, editorValue, updateQuery, saveState]);

  const handleExecute = useCallback(async () => {
    if (!editorValue.trim()) return;
    setExecuting(true);
    setError(null);
    setResult(null);
    try {
      const res = await executeDbQuery(credentialId, editorValue);
      setResult(res);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setExecuting(false);
    }
  }, [credentialId, editorValue, executeDbQuery]);

  const handleAiRun = useCallback(async () => {
    if (!editorValue.trim()) return;
    setTerminalExpanded(false);
    await queryDebug.start(credentialId, editorValue, error, serviceType);
  }, [credentialId, editorValue, error, serviceType, queryDebug.start]);

  const handleToggleFavorite = useCallback(
    (id: string, current: boolean) => {
      updateQuery(id, { isFavorite: !current });
    },
    [updateQuery],
  );

  const showTerminal = queryDebug.phase !== 'idle';

  return (
    <div className="flex h-full min-h-[500px]">
      {/* ── Sidebar: query list ─────────────────────────────────── */}
      <div className="w-64 border-r border-primary/10 flex flex-col shrink-0 bg-secondary/5">
        <div className="p-3 border-b border-primary/8">
          <AnimatePresence mode="wait">
            {isCreating ? (
              <motion.div
                key="create-input"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-1"
              >
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsCreating(false); }}
                  placeholder="Query title"
                  className="flex-1 px-2.5 py-1.5 rounded-xl text-sm bg-background/50 border border-primary/15 text-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-muted-foreground/30"
                />
                <button onClick={handleCreate} className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setIsCreating(false)} className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-secondary/40 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            ) : (
              <motion.button
                key="create-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-sm font-medium text-primary/80 hover:bg-primary/8 border border-dashed border-primary/15 hover:border-primary/25 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                New Query
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {queries.map((q) => (
            <div
              key={q.id}
              className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-xl cursor-pointer transition-all duration-150 ${
                selectedId === q.id
                  ? 'bg-primary/10 border border-primary/20 shadow-sm shadow-primary/5'
                  : 'hover:bg-secondary/40 border border-transparent'
              }`}
              onClick={() => handleSelect(q.id)}
            >
              <span className="flex-1 text-sm text-foreground/70 truncate">{q.title}</span>

              {q.last_run_ok !== null && (
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${q.last_run_ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
              )}

              <button
                onClick={(e) => { e.stopPropagation(); handleToggleFavorite(q.id, q.is_favorite); }}
                className={`p-0.5 transition-colors ${q.is_favorite ? 'text-amber-400' : 'text-muted-foreground/20 hover:text-amber-400/50'}`}
              >
                <Star className="w-3 h-3" fill={q.is_favorite ? 'currentColor' : 'none'} />
              </button>

              <button
                onClick={(e) => { e.stopPropagation(); deleteQuery(q.id); if (selectedId === q.id) setSelectedId(null); }}
                className="p-0.5 text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-red-400/60 transition-all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {queries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <div className="w-10 h-10 rounded-xl bg-secondary/30 border border-primary/10 flex items-center justify-center">
                <Plus className="w-4 h-4 text-muted-foreground/30" />
              </div>
              <p className="text-sm text-muted-foreground/40">No saved queries</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Editor + results ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedQuery ? (
          <>
            {/* ── Editor toolbar ── */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/8 bg-secondary/5 shrink-0">
              <span className="text-sm font-semibold text-foreground/70 flex-1 truncate">{selectedQuery.title}</span>
              <span className="text-sm uppercase tracking-wider text-muted-foreground/30 px-2 py-0.5 rounded-lg bg-secondary/40 border border-primary/8 font-medium">
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
                {saveState === 'saved' ? (
                  <Check className="w-3 h-3" />
                ) : saveState === 'saving' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving...' : 'Save'}
              </button>

              <button
                onClick={handleExecute}
                disabled={executing || !editorValue.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 hover:border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {executing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                {executing ? 'Running...' : 'Run'}
              </button>

              <button
                onClick={handleAiRun}
                disabled={queryDebug.isRunning || !editorValue.trim()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 text-violet-400 border border-violet-500/20 hover:from-violet-500/25 hover:to-fuchsia-500/20 hover:border-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm shadow-violet-500/5"
              >
                {queryDebug.isRunning ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Wand2 className="w-3 h-3" />
                )}
                {queryDebug.isRunning ? 'Debugging...' : 'AI Run'}
              </button>
            </div>

            {/* ── AI Debug TerminalStrip ── */}
            <AnimatePresence>
              {showTerminal && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <TerminalStrip
                    lastLine={queryDebug.lastLine}
                    lines={queryDebug.lines}
                    isRunning={queryDebug.isRunning}
                    isExpanded={terminalExpanded}
                    onToggle={() => setTerminalExpanded((v) => !v)}
                    onClear={queryDebug.clear}
                    expandedMaxHeight="max-h-52"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Editor ── */}
            <div className="px-4 pt-4 pb-2 shrink-0">
              <SqlEditor
                value={editorValue}
                onChange={setEditorValue}
                language={language}
                placeholder={language === 'redis' ? 'GET mykey' : 'SELECT * FROM ...'}
                onExecute={handleExecute}
                minHeight="160px"
              />
            </div>

            {/* ── Results ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              <AnimatePresence mode="wait">
                {error && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="p-3 rounded-xl bg-red-500/8 border border-red-500/15 text-sm text-red-400/90 whitespace-pre-wrap font-mono leading-relaxed"
                  >
                    {error}
                  </motion.div>
                )}

                {result && (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <QueryResultTable result={result} />
                  </motion.div>
                )}

                {!result && !error && !executing && (
                  <motion.div
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center pt-8"
                  >
                    <p className="text-sm text-muted-foreground/25">
                      {language === 'redis' ? 'Enter a Redis command and press Run or Ctrl+Enter' : 'Write a query and press Run or Ctrl+Enter'}
                    </p>
                  </motion.div>
                )}

                {executing && (
                  <motion.div
                    key="executing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center pt-8 gap-2"
                  >
                    <span className="relative flex h-3 w-3 items-center justify-center">
                      <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-40" />
                      <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
                    </span>
                    <span className="text-sm text-muted-foreground/40">Executing query...</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-secondary/20 border border-primary/10 flex items-center justify-center">
              <Wand2 className="w-5 h-5 text-muted-foreground/20" />
            </div>
            <p className="text-sm text-muted-foreground/35">Select or create a query</p>
          </div>
        )}
      </div>
    </div>
  );
}
