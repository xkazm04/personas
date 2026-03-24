import { useState, useCallback } from 'react';
import { isMutationQuery } from '../safeModeUtils';

/**
 * Shared safe-mode state for database query editors.
 *
 * Handles the mutation confirmation dialog flow:
 * 1. User submits query
 * 2. If safe mode is on and query is a mutation, stash it as `pendingMutation`
 * 3. User confirms or cancels
 * 4. On confirm, execute with `allowMutation: true`
 */
export function useQuerySafeMode(
  runQuery: (text: string, allowMutation: boolean) => Promise<void>,
) {
  const [safeMode, setSafeMode] = useState(true);
  const [pendingMutation, setPendingMutation] = useState<string | null>(null);

  const guardedExecute = useCallback(async (queryText: string) => {
    const text = queryText.trim();
    if (!text) return;
    if (safeMode && isMutationQuery(text)) {
      setPendingMutation(text);
      return;
    }
    await runQuery(text, !safeMode);
  }, [safeMode, runQuery]);

  const confirmMutation = useCallback(async () => {
    if (!pendingMutation) return;
    const text = pendingMutation;
    setPendingMutation(null);
    await runQuery(text, true);
  }, [pendingMutation, runQuery]);

  const cancelMutation = useCallback(() => {
    setPendingMutation(null);
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
