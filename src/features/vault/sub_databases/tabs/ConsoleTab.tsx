import { useState, useCallback, useRef } from 'react';
import { Play, Shield, ShieldOff, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useVaultStore } from "@/stores/vaultStore";
import { useTranslation } from '@/i18n/useTranslation';
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
  const { t } = useTranslation();
  const db = t.vault.databases;
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
              ? db.redis_placeholder
              : language === 'convex'
                ? db.convex_placeholder
                : db.sql_placeholder
          }
          onExecute={handleExecute}
          minHeight="100px"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handleExecute}
            disabled={executing || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-modal typo-body font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {executing ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
            {executing ? db.running : db.run_query}
          </button>
          <span className="typo-body text-foreground">Ctrl+Enter</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSafeMode((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body font-medium border transition-all ${
                safeMode
                  ? 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20 hover:bg-emerald-500/15'
                  : 'bg-amber-500/8 text-amber-400/80 border-amber-500/20 hover:bg-amber-500/15'
              }`}
              title={safeMode ? db.safe_mode_on : db.safe_mode_off}
            >
              {safeMode ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
              {safeMode ? db.safe_mode : db.write_mode}
            </button>
          </div>
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="typo-body text-foreground">{db.recent}</span>
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => handleHistoryClick(h.query)}
                className="px-2 py-0.5 rounded typo-code font-mono text-foreground bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:text-muted-foreground/70 transition-colors truncate max-w-[200px]"
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
        <div className="mx-4 mb-3 p-3 rounded-modal bg-amber-500/8 border border-amber-500/20 space-y-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <p className="typo-body font-medium text-amber-300/90">{db.modifies_data}</p>
              <p className="typo-body text-foreground">
                {db.modifies_data_hint}
              </p>
              <pre className="typo-code font-mono text-foreground bg-secondary/30 rounded-card px-2.5 py-1.5 overflow-x-auto max-h-20 border border-primary/5">
                {pendingMutation.length > 200 ? pendingMutation.slice(0, 200) + '...' : pendingMutation}
              </pre>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-6">
            <button
              onClick={handleConfirmMutation}
              className="px-3 py-1.5 rounded-modal typo-body font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
            >
              {db.execute_anyway}
            </button>
            <button
              onClick={handleCancelMutation}
              className="px-3 py-1.5 rounded-modal typo-body font-medium text-foreground hover:text-muted-foreground/70 hover:bg-secondary/40 border border-transparent hover:border-primary/10 transition-colors"
            >
              {t.common.cancel}
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
