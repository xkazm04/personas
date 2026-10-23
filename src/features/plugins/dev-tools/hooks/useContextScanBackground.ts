import { useCallback } from 'react';
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

  const startBackgroundScan = useCallback(
    async (projectId: string, rootPath: string, projectName: string) => {
      setContextScanActive(true);
      setContextScanComplete(false);
      useOverviewStore.getState().processStarted(
        'context_scan',
        undefined,
        `Context scan: ${projectName}`,
        { section: 'plugins', tab: 'context-map' },
      );

      // The completion listener belongs to the SCAN, not to the component that
      // started it. It used to live in a mount-scoped useEffect, so a scan
      // started from AddAppModal (or a page the user then left) lost its only
      // listener on unmount: the sidebar indicator pulsed until restart and
      // the Overview `context_scan` process never ended. The global
      // eventBridge handler settles factory scans only, so nothing else
      // settles this one. One listener per scan, removed once it settles.
      //
      // The backend emits a `ContextGenSummary`: `status` is "completed" or
      // "completed_with_warning" on success. No OS notification from here: the
      // backend already sends one authoritatively on completion.
      let scanId: string | null = null;
      let settled = false;
      const settle = (success: boolean) => {
        if (settled) return;
        settled = true;
        setContextScanActive(false);
        setContextScanComplete(success);
        useOverviewStore.getState().processEnded('context_scan', success ? 'completed' : 'failed');
        unlisten.then((fn) => fn()).catch(silentCatch('useContextScanBackground:unlisten'));
      };
      const unlisten = listen<{ scan_id: string; status?: string; error?: string | null }>(
        EventName.CONTEXT_GEN_COMPLETE,
        (event) => {
          // Another scan (a Factory cell, a fleet delta scan) finishing must
          // not settle this one.
          if (scanId !== null && event.payload.scan_id !== scanId) return;
          settle(event.payload.status !== 'failed');
        },
      );
      unlisten.catch(silentCatch('useContextScanBackground:listen'));

      // The store's scanCodebase reports a start failure into its own state
      // (`codebaseScanPhase: 'error'`) and resolves; it never rethrows. Read
      // that state instead of waiting on a catch that cannot run: a failed
      // start emits no completion event, so nothing else would settle it.
      let started: boolean;
      try {
        await scanCodebase(projectId, rootPath);
        const sys = useSystemStore.getState();
        started = sys.codebaseScanPhase !== 'error';
        scanId = sys.activeScanId;
      } catch {
        started = false;
      }
      if (!started) {
        settle(false);
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
