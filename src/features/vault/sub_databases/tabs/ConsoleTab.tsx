import { useState, useCallback } from 'react';
import { Play, Shield, ShieldOff } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import { SqlEditor } from '../SqlEditor';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { useDbQueryRunner } from '../hooks/useDbQueryRunner';
import { ConsoleOutput } from './ConsoleOutput';
import { MutationConfirmBanner } from './MutationConfirmBanner';

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

  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const recordHistory = useCallback((_result: unknown, text: string) => {
    setHistory((prev) => {
      const filtered = prev.filter((h) => h.query !== text);
      return [{ query: text, timestamp: Date.now() }, ...filtered].slice(0, 10);
    });
  }, []);

  const { executing, result, error, runQuery } = useDbQueryRunner(credentialId, undefined, recordHistory);

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
          <span className="typo-body text-foreground">{db.ctrl_enter}</span>
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
        <MutationConfirmBanner
          pendingMutation={pendingMutation}
          hint={db.modifies_data_hint}
          onConfirm={handleConfirmMutation}
          onCancel={handleCancelMutation}
        />
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
