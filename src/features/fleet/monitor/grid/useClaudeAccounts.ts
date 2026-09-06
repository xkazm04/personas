// useClaudeAccounts — the multi-plan switcher's data and actions.
//
// Same five-minute module cache as `useClaudeUsage`: a re-opened Monitor
// paints the last snapshot and reads nothing until the window has elapsed;
// the poll runs on that cadence; a manual refresh is offered only after it.
// Every MUTATION forces a read — the strip never shows a switch it only
// asked for, it shows the one the backend reports — and refreshes the stamp.
//
// The auto-rotate loop runs in the backend whether or not the Monitor is
// open; this hook only notices its result. When the snapshot's last-rotation
// stamp moves between two reads, the hook reports the event once so the
// strip can toast it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { silentCatch } from '@/lib/silentCatch';
import {
  captureClaudeAccount, listClaudeAccounts, removeClaudeAccount, setClaudeAutoRotate, switchClaudeAccount,
} from '@/api/fleet/claudeAccounts';
import type { ClaudeAccountsSnapshot } from '@/lib/bindings/ClaudeAccountsSnapshot';
import type { ClaudeAutoRotateConfig } from '@/lib/bindings/ClaudeAutoRotateConfig';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';
import { USAGE_CACHE_MS } from './useClaudeUsage';

let warmSnapshot: ClaudeAccountsSnapshot | null = null;
let warmAt: number | null = null;

export interface ClaudeAccountsState {
  snapshot: ClaudeAccountsSnapshot | null;
  ipcFailed: boolean;
  fetchedAt: number | null;
  canRefresh: boolean;
  refresh: () => Promise<void>;
  capture: () => Promise<ClaudeAccountsSnapshot>;
  switchTo: (id: string) => Promise<ClaudeAccountsSnapshot>;
  remove: (id: string) => Promise<ClaudeAccountsSnapshot>;
  setAutoRotate: (config: ClaudeAutoRotateConfig) => Promise<ClaudeAutoRotateConfig>;
}

export function useClaudeAccounts(
  enabled: boolean,
  now: number,
  onRotated?: (event: ClaudeRotationEvent) => void,
): ClaudeAccountsState {
  const [snapshot, setSnapshot] = useState<ClaudeAccountsSnapshot | null>(warmSnapshot);
  const [fetchedAt, setFetchedAt] = useState<number | null>(warmAt);
  const [ipcFailed, setIpcFailed] = useState(false);
  const lastRotationAt = useRef<number | null>(warmSnapshot?.lastRotation?.atMs ?? null);
  const onRotatedRef = useRef(onRotated);
  onRotatedRef.current = onRotated;

  const accept = useCallback((next: ClaudeAccountsSnapshot) => {
    warmSnapshot = next;
    warmAt = Date.now();
    setSnapshot(next);
    setFetchedAt(warmAt);
    setIpcFailed(false);
    const at = next.lastRotation?.atMs ?? null;
    if (at !== null && lastRotationAt.current !== null && at > lastRotationAt.current && next.lastRotation) {
      onRotatedRef.current?.(next.lastRotation);
    }
    lastRotationAt.current = at;
    return next;
  }, []);

  const read = useCallback(async (force: boolean) => {
    if (!force && warmAt !== null && Date.now() - warmAt < USAGE_CACHE_MS) {
      setSnapshot(warmSnapshot);
      setFetchedAt(warmAt);
      return;
    }
    try {
      accept(await listClaudeAccounts());
    } catch (err) {
      silentCatch('monitor:claudeAccounts')(err);
      setIpcFailed(true);
    }
  }, [accept]);

  const poll = useCallback(() => read(false), [read]);
  usePolling(poll, { interval: USAGE_CACHE_MS, enabled, name: 'monitor:claudeAccounts' });
  useEffect(() => {
    if (enabled) void read(false);
  }, [enabled, read]);

  const refresh = useCallback(() => read(true), [read]);
  const canRefresh = fetchedAt === null || now - fetchedAt >= USAGE_CACHE_MS;

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

  return { snapshot, ipcFailed, fetchedAt, canRefresh, refresh, capture, switchTo, remove, setAutoRotate };
}

/** Test hatch — the warm cache is module state. */
export function _resetClaudeAccountsForTests(): void {
  warmSnapshot = null;
  warmAt = null;
}
