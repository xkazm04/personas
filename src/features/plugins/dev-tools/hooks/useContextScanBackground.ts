import { useCallback, useEffect, useRef } from 'react';
import { useSystemStore } from "@/stores/systemStore";
import { useOverviewStore } from '@/stores/overviewStore';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { useTranslation } from '@/i18n/useTranslation';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { silentCatch } from '@/lib/silentCatch';


/**
 * Launches a codebase context scan as a background process.
 * Drives the sidebar pulsing indicator and fires an OS notification on completion.
 * Listens for the `context-gen-complete` Tauri event instead of relying on the
 * async return of scanCodebase (which returns immediately with a scan_id).
 */
export function useContextScanBackground() {
  const { t, tx } = useTranslation();
  const setContextScanActive = useSystemStore((s) => s.setContextScanActive);
  const setContextScanComplete = useSystemStore((s) => s.setContextScanComplete);
  const scanCodebase = useSystemStore((s) => s.scanCodebase);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const pendingProjectName = useRef<string | null>(null);

  const notifyCompletion = useCallback(async (projectName: string, success: boolean) => {
    const dt = t.plugins.dev_tools;
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === 'granted';
      }
      if (granted) {
        sendNotification({
          title: success ? dt.context_scan_ready_title : dt.context_scan_failed_title,
          body: tx(
            success ? dt.context_scan_ready_body : dt.context_scan_failed_body,
            { projectName },
          ),
        });
      }
    } catch (err) { silentCatch("features/plugins/dev-tools/hooks/useContextScanBackground:catch1")(err); }
  }, [t, tx]);

  // Listen for scan completion event from backend.
  //
  // Track the `listen()` promise itself (not just the resolved unlisten fn)
  // so that an unmount which fires before the promise resolves still tears
  // the listener down via `.then((fn) => fn())`. The previous fire-and-forget
  // pattern (`listen(...).then((fn) => unlisten = fn)`) leaked the listener
  // forever in that race window: the cleanup ran with `unlisten=null` and
  // the next mount registered a duplicate. After N flips between Dev Tools
  // and other tabs, OS notifications and `processEnded()` fired N times per
  // scan — corrupting Overview metrics. Same shape as the listeners in
  // `useCreativeSession.ts`.
  useEffect(() => {
    // The backend emits a `ContextGenSummary` here, NOT a `{ success }` object.
    // Its `status` is "completed" or "completed_with_warning" on success — and
    // the failure path never emits this event at all (it surfaces its own OS
    // notification). The payload has no `success` field, so the previous
    // `event.payload.success` read was always `undefined` → falsy → every
    // SUCCESSFUL scan was reported as a failure (false "scan failed" OS
    // notification + a bogus 'failed' Overview metric), even when the scan
    // finished correctly. Derive success from `status` instead.
    //
    // We intentionally do NOT fire an OS notification from here: the backend
    // already sends one authoritatively (`crate::notifications::send`, fired
    // even when no Dev Tools UI is mounted), so calling notifyCompletion here
    // would double-notify. This listener only updates in-app state. The
    // start-failure catch in startBackgroundScan still uses notifyCompletion
    // because the backend never reaches its notification on that path.
    const unsub = listen<{ scan_id: string; status?: string; error?: string | null }>(
      EventName.CONTEXT_GEN_COMPLETE,
      (event) => {
        pendingProjectName.current = null;
        const success = event.payload.status !== 'failed';
        setContextScanActive(false);
        setContextScanComplete(success);
        useOverviewStore.getState().processEnded(
          'context_scan',
          success ? 'completed' : 'failed',
        );
      },
    );
    return () => { unsub.then((fn) => fn()); };
  }, [setContextScanActive, setContextScanComplete]);

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
