import { useState, useCallback, useRef } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { extractErrorMessage } from '../safeModeUtils';
import type { QueryResult } from '@/api/vault/database/dbSchema';

/**
 * Shared query-execution state for database query editors (Console tab,
 * saved-query editor pane).
 *
 * Owns `executing` / `result` / `error` plus a generation-counter guard
 * (`queryGenRef`) so a slow in-flight query can never clobber state for a
 * newer run — or set state after the caller has moved on to a different
 * query/credential — once a fresher `runQuery` call has started.
 *
 * `onSuccess` (optional) runs after a successful query, still under the
 * generation guard, for callers that need a side effect (e.g. Console's
 * recent-query history). Memoize it with `useCallback` — an unstable
 * reference changes `runQuery`'s identity on every render, which trips
 * `useQuerySafeMode`'s context-drift guard needlessly.
 */
export function useDbQueryRunner(
  credentialId: string,
  queryId?: string,
  onSuccess?: (result: QueryResult, text: string) => void,
) {
  const executeDbQuery = useVaultStore((s) => s.executeDbQuery);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryGenRef = useRef(0);

  const runQuery = useCallback(async (text: string, allowMutation: boolean) => {
    const gen = ++queryGenRef.current;
    setExecuting(true); setError(null); setResult(null);
    try {
      const res = await executeDbQuery(credentialId, text, queryId, allowMutation);
      if (gen !== queryGenRef.current) return;
      setResult(res);
      onSuccess?.(res, text);
    } catch (err) {
      if (gen !== queryGenRef.current) return;
      setError(extractErrorMessage(err));
    } finally {
      if (gen === queryGenRef.current) {
        setExecuting(false);
      }
    }
  }, [credentialId, executeDbQuery, queryId, onSuccess]);

  return { executing, result, error, setResult, setError, runQuery };
}
