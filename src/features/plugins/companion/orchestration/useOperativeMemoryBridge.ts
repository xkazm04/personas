import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';
import { useOperativeMemoryStore } from './operativeMemoryStore';

/**
 * D7 — Live ops bridge. Subscribes to
 * `athena://orchestration/digest-changed` (emitted from every backend
 * mutation site), debounces 250ms, re-fetches the digest via
 * `companion_get_operative_memory_digest`, populates the
 * [`useOperativeMemoryStore`].
 *
 * Mount once near the app root (next to `useFleetCompanionBridge` and
 * `useMcpRequestBridge`).
 *
 * Why debounce: fleet hooks can fire several events back-to-back when
 * a session lands its first tool calls (SessionStart → PreToolUse →
 * PostToolUse → state change). Without debounce we'd re-render the
 * strip on each, paying for the full digest string round-trip every
 * time. 250ms is short enough that the UI feels live but long enough
 * to coalesce normal bursts.
 *
 * Also fetches once on mount so the strip has its initial state even
 * before the first event fires.
 */
export function useOperativeMemoryBridge(): void {
  const setDigest = useOperativeMemoryStore((s) => s.setDigest);
  const setFetching = useOperativeMemoryStore((s) => s.setFetching);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const doFetch = async () => {
      if (inFlightRef.current) {
        // Coalesce: an in-flight request will pick up the latest
        // state when it returns. Mark that we want another pass.
        pendingRef.current = true;
        return;
      }
      inFlightRef.current = true;
      setFetching(true);
      try {
        const digest = await invoke<string>('companion_get_operative_memory_digest', {});
        if (!cancelled) setDigest(digest ?? '');
      } catch (e) {
        silentCatch('useOperativeMemoryBridge:fetch')(e);
      } finally {
        inFlightRef.current = false;
        setFetching(false);
        if (pendingRef.current && !cancelled) {
          pendingRef.current = false;
          // Re-run if another event landed during the in-flight call.
          void doFetch();
        }
      }
    };

    const scheduleFetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void doFetch();
      }, 250);
    };

    // Initial fetch — the digest may already be populated from
    // pre-mount activity (the bridge mounts after the app shell, and
    // the backend can have an op in flight already).
    void doFetch();

    const un = listen<unknown>('athena://orchestration/digest-changed', () => {
      scheduleFetch();
    });
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      un.then((fn) => fn());
    };
    // setDigest / setFetching are stable zustand setters; one-shot mount is intended
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
