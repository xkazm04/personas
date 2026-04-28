import { useState, useCallback, useRef, useEffect } from 'react';
import { isMutationQuery } from '../safeModeUtils';

/**
 * Shared safe-mode state for database query editors.
 *
 * Handles the mutation confirmation dialog flow:
 * 1. User submits query
 * 2. If safe mode is on and query is a mutation, stash it as `pendingMutation`
 * 3. User confirms or cancels
 * 4. On confirm, execute with `allowMutation: true`
 *
 * Context-drift guard: a pending mutation is bound to the `runQuery` closure
 * that was active at submit time. If the parent component swaps `runQuery`
 * (typically because the user switched credential / database / query tab),
 * the pending mutation is auto-cleared so the user cannot accept a destructive
 * confirm dialog whose underlying connection has silently changed beneath them.
 * Callers should memoize `runQuery` with `useCallback` keyed on the
 * (credentialId, queryId) tuple for the guard to track context cleanly.
 */
export function useQuerySafeMode(
  runQuery: (text: string, allowMutation: boolean) => Promise<void>,
) {
  const [safeMode, setSafeMode] = useState(true);
  const [pendingMutation, setPendingMutation] = useState<string | null>(null);
  // Pinned to the runQuery identity in effect when the mutation was stashed.
  // If the parent's runQuery changes (different credential / different query),
  // the next effect-tick clears the pending mutation so confirming wouldn't
  // run it against the wrong DB. Captured via ref so the guard does not
  // become a dep of guardedExecute / confirmMutation.
  const pendingRunQueryRef = useRef<typeof runQuery | null>(null);

  useEffect(() => {
    if (pendingRunQueryRef.current && pendingRunQueryRef.current !== runQuery) {
      setPendingMutation(null);
      pendingRunQueryRef.current = null;
    }
  }, [runQuery]);

  const guardedExecute = useCallback(async (queryText: string) => {
    const text = queryText.trim();
    if (!text) return;
    if (safeMode && isMutationQuery(text)) {
      setPendingMutation(text);
      pendingRunQueryRef.current = runQuery;
      return;
    }
    await runQuery(text, !safeMode);
  }, [safeMode, runQuery]);

  const confirmMutation = useCallback(async () => {
    if (!pendingMutation) return;
    // Belt-and-braces: even if the effect hasn't fired yet (synchronous click
    // race), refuse to run the pending mutation against a different runQuery.
    if (pendingRunQueryRef.current && pendingRunQueryRef.current !== runQuery) {
      setPendingMutation(null);
      pendingRunQueryRef.current = null;
      return;
    }
    const text = pendingMutation;
    setPendingMutation(null);
    pendingRunQueryRef.current = null;
    await runQuery(text, true);
  }, [pendingMutation, runQuery]);

  const cancelMutation = useCallback(() => {
    setPendingMutation(null);
    pendingRunQueryRef.current = null;
  }, []);

  return {
    safeMode,
    setSafeMode,
    pendingMutation,
    guardedExecute,
    confirmMutation,
    cancelMutation,
  };
}
