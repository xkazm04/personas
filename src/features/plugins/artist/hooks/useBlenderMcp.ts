import { useState, useCallback, useEffect, useRef } from 'react';
import { artistCheckBlender, artistInstallBlenderMcp } from '@/api/artist';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';

/** Cache TTL: 5 minutes before re-checking blender status */
const STATUS_CACHE_TTL = 5 * 60 * 1000;

export function useBlenderMcp() {
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const setBlenderMcpState = useSystemStore((s) => s.setBlenderMcpState);
  const cachedStatus = useSystemStore((s) => s.cachedBlenderStatus);
  const setCachedBlenderStatus = useSystemStore((s) => s.setCachedBlenderStatus);
  const mountedRef = useRef(true);

  const check = useCallback(async (force = false) => {
    // Read latest cache from store to avoid stale closure deps
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
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : String(err),
        'error',
      );
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, [setCachedBlenderStatus, setBlenderMcpState]);

  const installMcp = useCallback(async () => {
    setInstalling(true);
    try {
      await artistInstallBlenderMcp();
      useToastStore.getState().addToast('blender-mcp package installed successfully.', 'success');
      await check(true);
    } catch (err) {
      setBlenderMcpState('error');
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : String(err),
        'error',
      );
    } finally {
      if (mountedRef.current) setInstalling(false);
    }
  }, [check, setBlenderMcpState]);

  // Deferred auto-check: yield to the main thread before running
  useEffect(() => {
    mountedRef.current = true;
    const id = requestIdleCallback(() => { check(); }, { timeout: 2000 });
    return () => {
      mountedRef.current = false;
      cancelIdleCallback(id);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { status: cachedStatus, checking, installing, check: () => check(true), installMcp };
}
