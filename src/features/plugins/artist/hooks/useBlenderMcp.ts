import { useState, useCallback, useEffect } from 'react';
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
  const checkedAt = useSystemStore((s) => s.blenderStatusCheckedAt);
  const setCachedBlenderStatus = useSystemStore((s) => s.setCachedBlenderStatus);

  const check = useCallback(async (force = false) => {
    // Skip if we have a recent cached result
    if (!force && cachedStatus && checkedAt && Date.now() - checkedAt < STATUS_CACHE_TTL) {
      return;
    }

    setChecking(true);
    try {
      const result = await artistCheckBlender();
      setCachedBlenderStatus(result);
      if (result.mcpRunning) {
        setBlenderMcpState('running');
      } else if (result.mcpInstalled) {
        setBlenderMcpState('installed');
      } else {
        setBlenderMcpState('not-installed');
      }
    } catch (err) {
      setBlenderMcpState('error');
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : String(err),
        'error',
      );
    } finally {
      setChecking(false);
    }
  }, [cachedStatus, checkedAt, setCachedBlenderStatus, setBlenderMcpState]);

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
      setInstalling(false);
    }
  }, [check, setBlenderMcpState]);

  // Auto-check on mount (uses cache if available)
  useEffect(() => { check(); }, [check]);

  return { status: cachedStatus, checking, installing, check: () => check(true), installMcp };
}
