import { useState, useCallback, useRef } from 'react';
import { Play, Shield, ShieldOff, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useVaultStore } from "@/stores/vaultStore";
import { SqlEditor } from '../SqlEditor';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { ConsoleOutput } from './ConsoleOutput';
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

interface ConsoleTabProps {
  credentialId: string;
  language: string;
}

interface HistoryEntry {
  query: string;
  timestamp: number;
}

export function ConsoleTab({ credentialId, language }: ConsoleTabProps) {
  const executeDbQuery = useVaultStore((s) => s.executeDbQuery);

  const [query, setQuery] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const queryGenRef = useRef(0);

  const runQuery = useCallback(async (text: string, allowMutation: boolean) => {
    const gen = ++queryGenRef.current;
    setExecuting(true); setError(null); setResult(null);
    try {
      const res = await executeDbQuery(credentialId, text, undefined, allowMutation);
      if (gen !== queryGenRef.current) return;
      setResult(res);
      setHistory((prev) => {
        const filtered = prev.filter((h) => h.query !== text);
        return [{ query: text, timestamp: Date.now() }, ...filtered].slice(0, 10);
      });
    } catch (err) {
      if (gen !== queryGenRef.current) return;
      setError(extractErrorMessage(err));
    } finally {
      if (gen === queryGenRef.current) {
        setExecuting(false);
      }
    }
  }, [credentialId, executeDbQuery]);

  const { safeMode, setSafeMode, pendingMutation, guardedExecute, confirmMutation: handleConfirmMutation, cancelMutation: handleCancelMutation } = useQuerySafeMode(runQuery);

  const handleExecute = useCallback(async () => {
    const text = query.trim();
    if (!text || executing) return;
    await guardedExecute(text);
  }, [query, executing, guardedExecute]);

  const handleHistoryClick = useCallback((q: string) => { setQuery(q); }, []);

  return (
    <div className="flex flex-col h-full min-h-[500px]">
      {/* Query input area */}
      <div className="p-4 space-y-3 shrink-0">
        <SqlEditor
          value={query}
          onChange={setQuery}
          language={language}
          placeholder={
            language === 'redis'
              ? 'Enter Redis command (e.g. GET mykey, HGETALL users:1)'
              : language === 'convex'
                ? 'Enter table name to browse, or JSON body: {"path": "func:name", "args": {}}'
                : 'Enter SQL query (Ctrl+Enter to execute)'
          }
          onExecute={handleExecute}
          minHeight="100px"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handleExecute}
            disabled={executing || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {executing ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
            {executing ? 'Running...' : 'Run Query'}
          </button>
          <span className="text-sm text-muted-foreground/60">Ctrl+Enter</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSafeMode((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                safeMode
                  ? 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20 hover:bg-emerald-500/15'
                  : 'bg-amber-500/8 text-amber-400/80 border-amber-500/20 hover:bg-amber-500/15'
              }`}
              title={safeMode ? 'Safe mode ON: write queries require confirmation' : 'Safe mode OFF: all queries execute directly'}
            >
              {safeMode ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
              {safeMode ? 'Safe Mode' : 'Write Mode'}
            </button>
          </div>
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm text-muted-foreground/60">Recent:</span>
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => handleHistoryClick(h.query)}
                className="px-2 py-0.5 rounded text-sm font-mono text-muted-foreground/50 bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:text-muted-foreground/70 transition-colors truncate max-w-[200px]"
                title={h.query}
              >
                {h.query.length > 40 ? h.query.slice(0, 40) + '...' : h.query}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Mutation confirmation dialog */}
      {pendingMutation && (
        <div className="mx-4 mb-3 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium text-amber-300/90">This query modifies data</p>
              <p className="text-sm text-muted-foreground/60">
                The statement appears to be a write operation (INSERT, UPDATE, DELETE, DROP, etc.).
                Are you sure you want to execute it?
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

      <ConsoleOutput
        result={result}
        error={error}
        executing={executing}
        pendingMutation={pendingMutation}
        language={language}
      />
    </div>
  );
}
