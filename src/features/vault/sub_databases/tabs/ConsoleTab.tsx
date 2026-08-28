import { useState, useCallback, useEffect } from 'react';
import { Play, Shield, ShieldOff, X } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
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

const MAX_HISTORY = 10;
/** How many databases' histories are kept before the least-recently-used one is dropped. */
const MAX_TRACKED_CREDENTIALS = 20;

/**
 * Query history outlives the component, because the component does not outlive
 * a tab switch. ConsoleTab unmounts the moment the user opens Tables, so the
 * `useState` this replaces took the last ten queries with it and the user came
 * back to an empty strip.
 *
 * The sql-console golden path treats that as a security cost rather than a
 * nuisance: the built-in console is a CONTAINMENT feature, and every
 * convenience it lacks is a reason to paste the connection credential into an
 * external client, where the vault stops having custody of it.
 *
 * Same shape as the repo's other remount caches (`LifecyclePage`,
 * `CompetitionList`): module-scoped, keyed by entity, capped in both
 * directions. Deliberately memory-only and never localStorage — a query text
 * can carry the very data the vault is responsible for, and it must not
 * survive the process or reach disk.
 */
const historyByCredential = new Map<string, HistoryEntry[]>();

function readHistory(credentialId: string): HistoryEntry[] {
  return historyByCredential.get(credentialId) ?? [];
}

function writeHistory(credentialId: string, entries: HistoryEntry[]): void {
  // Delete-then-set moves this key to the end, making Map insertion order an
  // LRU queue; the oldest database's history is what gets dropped.
  historyByCredential.delete(credentialId);
  historyByCredential.set(credentialId, entries);
  while (historyByCredential.size > MAX_TRACKED_CREDENTIALS) {
    const oldest = historyByCredential.keys().next().value;
    if (oldest === undefined) break;
    historyByCredential.delete(oldest);
  }
}

/** Drop every database's history. Tests only — this cache is process-scoped. */
export function __resetConsoleHistoryForTests(): void {
  historyByCredential.clear();
}

export function ConsoleTab({ credentialId, language }: ConsoleTabProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;

  const [query, setQuery] = useState('');
  // Seeded from the module cache, so a remount paints the strip warm.
  const [history, setHistory] = useState<HistoryEntry[]>(() => readHistory(credentialId));

  // The tab can also be re-pointed at another database without unmounting.
  useEffect(() => {
    setHistory(readHistory(credentialId));
  }, [credentialId]);

  const recordHistory = useCallback((_result: unknown, text: string) => {
    // Read from the module cache, not from `prev`: it is the source of truth,
    // and a state updater must stay pure (StrictMode double-invokes it) while
    // this write is not.
    const filtered = readHistory(credentialId).filter((h) => h.query !== text);
    const next = [{ query: text, timestamp: Date.now() }, ...filtered].slice(0, MAX_HISTORY);
    writeHistory(credentialId, next);
    setHistory(next);
  }, [credentialId]);

  const { executing, result, error, runQuery, cancelQuery } = useDbQueryRunner(credentialId, undefined, recordHistory);

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
          {/* Busy state belongs to the control the user pressed: Button renders a
              REAL spinner and sets aria-busy. feedback/LoadingSpinner renders null,
              so the old ternary deleted the Play icon and put nothing in its place. */}
          <Button
            variant="accent"
            accentColor="emerald"
            size="md"
            onClick={handleExecute}
            disabled={!query.trim()}
            loading={executing}
            loadingLabel={db.running}
            icon={<Play className="w-3.5 h-3.5" />}
            className="rounded-modal typo-body"
          >
            {db.run_query}
          </Button>
          {/* The saved-query editor has offered this since useDbQueryRunner grew
              a cancellation handle (QueryToolbar.tsx); the console destructured
              everything from the same hook EXCEPT cancelQuery, so an identical
              query run one tab over was uncancellable and the user's only exit
              was to sit out the backend's QUERY_TIMEOUT. */}
          {executing && (
            <Button
              variant="accent"
              accentColor="rose"
              size="md"
              onClick={cancelQuery}
              icon={<X className="w-3 h-3" />}
              className="rounded-modal typo-body"
            >
              {t.common.cancel}
            </Button>
          )}
          <span className="typo-body text-foreground">{db.ctrl_enter}</span>
          <div className="ml-auto flex items-center gap-2">
            <Tooltip content={safeMode ? db.safe_mode_on : db.safe_mode_off}>
              <button
                type="button"
                onClick={() => setSafeMode((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body font-medium border transition-all ${
                  safeMode
                    ? 'bg-emerald-500/8 text-emerald-400/80 border-emerald-500/20 hover:bg-emerald-500/15'
                    : 'bg-amber-500/8 text-amber-400/80 border-amber-500/20 hover:bg-amber-500/15'
                }`}
              >
                {safeMode ? <Shield className="w-3.5 h-3.5" /> : <ShieldOff className="w-3.5 h-3.5" />}
                {safeMode ? db.safe_mode : db.write_mode}
              </button>
            </Tooltip>
          </div>
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="typo-body text-foreground">{db.recent}</span>
            {history.map((h, i) => (
              <Tooltip key={i} content={h.query}>
                <button
                  type="button"
                  onClick={() => handleHistoryClick(h.query)}
                  className="px-2 py-0.5 rounded typo-code font-mono text-foreground bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:text-muted-foreground/70 transition-colors truncate max-w-[200px]"
                >
                  {h.query.length > 40 ? h.query.slice(0, 40) + '...' : h.query}
                </button>
              </Tooltip>
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
