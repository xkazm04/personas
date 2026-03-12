import { useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

/**
 * Launches a codebase context scan as a background process.
 * Drives the sidebar pulsing indicator and fires an OS notification on completion.
 */
export function useContextScanBackground() {
  const setContextScanActive = usePersonaStore((s) => s.setContextScanActive);
  const setContextScanComplete = usePersonaStore((s) => s.setContextScanComplete);
  const scanCodebase = usePersonaStore((s) => s.scanCodebase);
  const setDevToolsTab = usePersonaStore((s) => s.setDevToolsTab);

  const notifyCompletion = useCallback(async (projectName: string, success: boolean) => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === 'granted';
      }
      if (granted) {
        sendNotification({
          title: success ? 'Context Map Ready' : 'Context Scan Failed',
          body: success
            ? `Codebase scan for "${projectName}" completed. Context map is ready to explore.`
            : `Codebase scan for "${projectName}" failed. Check the Context Map for details.`,
        });
      }
    } catch {
      // Notification permission denied or unavailable -- silently ignore
    }
  }, []);

  const startBackgroundScan = useCallback(
    async (projectId: string, rootPath: string, projectName: string) => {
      setContextScanActive(true);
      setContextScanComplete(false);

      try {
        await scanCodebase(projectId, rootPath);
        setContextScanComplete(true);
        await notifyCompletion(projectName, true);
      } catch {
        await notifyCompletion(projectName, false);
      } finally {
        setContextScanActive(false);
      }
    },
    [scanCodebase, setContextScanActive, setContextScanComplete, notifyCompletion],
  );

  const navigateToContextMap = useCallback(() => {
    setContextScanComplete(false);
    setDevToolsTab('context-map');
  }, [setContextScanComplete, setDevToolsTab]);

  return { startBackgroundScan, navigateToContextMap };
}
