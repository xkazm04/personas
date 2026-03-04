import { useState, useCallback } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
import type { QueryResult } from '@/api/dbSchema';

/** Extract a human-readable error message from a Tauri IPC error. */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'error' in err) {
    return String((err as Record<string, unknown>).error);
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return 'Unknown error'; }
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
  const executeDbQuery = usePersonaStore((s) => s.executeDbQuery);

  const [query, setQuery] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const handleExecute = useCallback(async () => {
    const text = query.trim();
    if (!text || executing) return;

    setExecuting(true);
    setError(null);
    setResult(null);

    try {
      const res = await executeDbQuery(credentialId, text);
      setResult(res);

      // Add to history (dedup)
      setHistory((prev) => {
        const filtered = prev.filter((h) => h.query !== text);
        return [{ query: text, timestamp: Date.now() }, ...filtered].slice(0, 10);
      });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setExecuting(false);
    }
  }, [credentialId, query, executing, executeDbQuery]);

  const handleHistoryClick = useCallback((q: string) => {
    setQuery(q);
  }, []);

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
              : 'Enter SQL query (Ctrl+Enter to execute)'
          }
          onExecute={handleExecute}
          minHeight="100px"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={handleExecute}
            disabled={executing || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {executing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {executing ? 'Running...' : 'Run Query'}
          </button>

          <span className="text-xs text-muted-foreground/30">Ctrl+Enter</span>
        </div>

        {/* History chips */}
        {history.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground/30">Recent:</span>
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => handleHistoryClick(h.query)}
                className="px-2 py-0.5 rounded text-xs font-mono text-muted-foreground/50 bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:text-muted-foreground/70 transition-colors truncate max-w-[200px]"
                title={h.query}
              >
                {h.query.length > 40 ? h.query.slice(0, 40) + '...' : h.query}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 border-t border-primary/5">
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 whitespace-pre-wrap font-mono">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4">
            <QueryResultTable result={result} />
          </div>
        )}

        {!result && !error && !executing && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground/30">
              {language === 'redis' ? 'Enter a Redis command and click Run' : 'Write a query and press Run or Ctrl+Enter'}
            </p>
          </div>
        )}

        {executing && (
          <div className="flex items-center justify-center h-full gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
            <span className="text-sm text-muted-foreground/40">Executing query...</span>
          </div>
        )}
      </div>
    </div>
  );
}
