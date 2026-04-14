import { useCallback, useEffect, useRef } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useOverviewStore } from '@/stores/overviewStore';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

/**
 * Launches a codebase context scan as a background process.
 * Drives the sidebar pulsing indicator and fires an OS notification on completion.
 * Listens for the `context-gen-complete` Tauri event instead of relying on the
 * async return of scanCodebase (which returns immediately with a scan_id).
 */
export function useContextScanBackground() {
  const setContextScanActive = useSystemStore((s) => s.setContextScanActive);
  const setContextScanComplete = useSystemStore((s) => s.setContextScanComplete);
  const scanCodebase = useSystemStore((s) => s.scanCodebase);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const pendingProjectName = useRef<string | null>(null);

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

  // Listen for scan completion event from backend
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ scan_id: string; success: boolean }>(EventName.CONTEXT_GEN_COMPLETE, (event) => {
      const name = pendingProjectName.current ?? 'project';
      pendingProjectName.current = null;
      setContextScanActive(false);
      setContextScanComplete(event.payload.success);
      useOverviewStore.getState().processEnded(
        'context_scan',
        event.payload.success ? 'completed' : 'failed',
      );
      notifyCompletion(name, event.payload.success);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [setContextScanActive, setContextScanComplete, notifyCompletion]);

  const startBackgroundScan = useCallback(
    async (projectId: string, rootPath: string, projectName: string) => {
      setContextScanActive(true);
      setContextScanComplete(false);
      pendingProjectName.current = projectName;
      useOverviewStore.getState().processStarted(
        'context_scan',
        undefined,
        `Context scan: ${projectName}`,
        { section: 'plugins', tab: 'context-map' },
      );

      try {
        await scanCodebase(projectId, rootPath);
        // scanCodebase returns immediately with scan_id — actual completion
        // comes via context-gen-complete event handled in useEffect above
      } catch {
        pendingProjectName.current = null;
        setContextScanActive(false);
        useOverviewStore.getState().processEnded('context_scan', 'failed');
        await notifyCompletion(projectName, false);
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
