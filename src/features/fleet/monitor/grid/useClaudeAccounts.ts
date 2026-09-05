// useClaudeAccounts — the multi-plan switcher's data and actions.
//
// One poll on the shared coordinator, a module-scoped warm cache (loading
// v2, mechanic 4), and the last GOOD snapshot retained across a failed read.
// Every mutation returns the next snapshot, so the strip never shows a
// switch it only asked for — it shows the one the backend reports.
//
// The auto-rotate loop runs in the backend whether or not the Monitor is
// open; this hook only notices its result. When the snapshot's last-rotation
// stamp moves between two reads, the hook reports the event once so the
// strip can toast it — the operator should never discover from a bill that
// their login changed under them.

import { useCallback, useRef, useState } from 'react';
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { silentCatch } from '@/lib/silentCatch';
import {
  captureClaudeAccount, listClaudeAccounts, removeClaudeAccount, setClaudeAutoRotate, switchClaudeAccount,
} from '@/api/fleet/claudeAccounts';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { ClaudeAutoRotateConfig } from '@/lib/bindings/ClaudeAutoRotateConfig';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';

export const ACCOUNTS_POLL_MS = 60_000;

let warmSnapshot: ClaudeAccountsSnapshot | null = null;

export interface ClaudeAccountsState {
  snapshot: ClaudeAccountsSnapshot | null;
  ipcFailed: boolean;
  lastRefreshed: number | null;
  capture: () => Promise<ClaudeAccountsSnapshot>;
  switchTo: (id: string) => Promise<ClaudeAccountsSnapshot>;
  remove: (id: string) => Promise<ClaudeAccountsSnapshot>;
  setAutoRotate: (config: ClaudeAutoRotateConfig) => Promise<ClaudeAutoRotateConfig>;
}

export function useClaudeAccounts(
  enabled: boolean,
  onRotated?: (event: ClaudeRotationEvent) => void,
): ClaudeAccountsState {
  const [snapshot, setSnapshot] = useState<ClaudeAccountsSnapshot | null>(warmSnapshot);
  const [ipcFailed, setIpcFailed] = useState(false);
  const lastRotationAt = useRef<number | null>(warmSnapshot?.lastRotation?.atMs ?? null);
  const onRotatedRef = useRef(onRotated);
  onRotatedRef.current = onRotated;

  const accept = useCallback((next: ClaudeAccountsSnapshot) => {
    warmSnapshot = next;
    setSnapshot(next);
    setIpcFailed(false);
    const at = next.lastRotation?.atMs ?? null;
    if (at !== null && lastRotationAt.current !== null && at > lastRotationAt.current && next.lastRotation) {
      onRotatedRef.current?.(next.lastRotation);
    }
    lastRotationAt.current = at;
    return next;
  }, []);

  const load = useCallback(async () => {
    try {
      accept(await listClaudeAccounts());
    } catch (err) {
      silentCatch('monitor:claudeAccounts')(err);
      setIpcFailed(true);
    }
  }, [accept]);

  const { lastRefreshed } = usePolling(load, {
    interval: ACCOUNTS_POLL_MS,
    enabled,
    name: 'monitor:claudeAccounts',
  });

  const capture = useCallback(() => captureClaudeAccount().then(accept), [accept]);
  const switchTo = useCallback((id: string) => switchClaudeAccount(id).then(accept), [accept]);
  const remove = useCallback((id: string) => removeClaudeAccount(id).then(accept), [accept]);
  const setAutoRotate = useCallback(
    async (config: ClaudeAutoRotateConfig) => {
      const saved = await setClaudeAutoRotate(config);
      setSnapshot((prev) => {
        if (!prev) return prev;
        const next = { ...prev, autoRotate: saved };
        warmSnapshot = next;
        return next;
      });
      return saved;
    },
    [],
  );

  return { snapshot, ipcFailed, lastRefreshed, capture, switchTo, remove, setAutoRotate };
}

/** Test hatch — the warm cache is module state. */
export function _resetClaudeAccountsForTests(): void {
  warmSnapshot = null;
}
