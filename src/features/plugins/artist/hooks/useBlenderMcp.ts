import { useState, useCallback, useEffect, useRef } from 'react';
import { artistCheckBlender, artistInstallBlenderMcp } from '@/api/artist';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';

/** Cache TTL: 5 minutes before the cached status is considered stale. */
const STATUS_CACHE_TTL = 5 * 60 * 1000;

/**
 * useBlenderMcp — lazy, never blocks the UI thread.
 *
 * - No automatic check on mount. The first status query happens when the
 *   user explicitly expands Creative Studio's env status panel or clicks
 *   Refresh. This keeps the Creative Studio tab snappy even on systems
 *   where `pip show blender-mcp` is slow.
 * - The Rust command is fully async (tokio::process::Command), so calls
 *   never block the IPC worker either.
 * - Cached results are shared via `useSystemStore`, so repeated mounts
 *   within 5 minutes are free.
 */
export function useBlenderMcp() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const setBlenderMcpState = useSystemStore((s) => s.setBlenderMcpState);
  const cachedStatus = useSystemStore((s) => s.cachedBlenderStatus);
  const setCachedBlenderStatus = useSystemStore((s) => s.setCachedBlenderStatus);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const check = useCallback(
    async (force = false) => {
      const store = useSystemStore.getState();
      const cached = store.cachedBlenderStatus;
      const at = store.blenderStatusCheckedAt;

      if (!force && cached && at && Date.now() - at < STATUS_CACHE_TTL) {
        return;
      }

      setChecking(true);
      try {
        const result = await artistCheckBlender();
        if (!mountedRef.current) return;
        setCachedBlenderStatus(result);
        if (result.mcpRunning) {
          setBlenderMcpState('running');
        } else if (result.mcpInstalled) {
          setBlenderMcpState('installed');
        } else {
          setBlenderMcpState('not-installed');
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setBlenderMcpState('error');
        useToastStore
          .getState()
          .addToast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        if (mountedRef.current) setChecking(false);
      }
    },
    [setCachedBlenderStatus, setBlenderMcpState],
  );

  const installMcp = useCallback(async () => {
    setInstalling(true);
    try {
      await artistInstallBlenderMcp();
      useToastStore.getState().addToast('blender-mcp package installed successfully.', 'success');
      await check(true);
    } catch (err) {
      setBlenderMcpState('error');
      useToastStore
        .getState()
        .addToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      if (mountedRef.current) setInstalling(false);
    }
  }, [check, setBlenderMcpState]);

  return {
    status: cachedStatus,
    checking,
    installing,
    check: () => check(true),
    installMcp,
  };
}
