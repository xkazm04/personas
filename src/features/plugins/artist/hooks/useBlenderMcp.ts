import { useState, useCallback, useEffect } from 'react';
import { artistCheckBlender, artistInstallBlenderMcp, type BlenderMcpStatus } from '@/api/artist';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';

export function useBlenderMcp() {
  const [status, setStatus] = useState<BlenderMcpStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const setBlenderMcpState = useSystemStore((s) => s.setBlenderMcpState);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const result = await artistCheckBlender();
      setStatus(result);
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
  }, [setBlenderMcpState]);

  const installMcp = useCallback(async () => {
    setInstalling(true);
    try {
      await artistInstallBlenderMcp();
      useToastStore.getState().addToast('blender-mcp package installed successfully.', 'success');
      // Re-check status after install
      await check();
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

  // Auto-check on mount
  useEffect(() => { check(); }, [check]);

  return { status, checking, installing, check, installMcp };
}
