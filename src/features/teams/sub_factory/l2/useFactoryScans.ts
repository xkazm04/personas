// The L2 Overview's four real scans, moved out of the old Deck toolbar when the
// tab was composed from the kit: Scan for KPIs (polled to completion), Scan
// features (use cases), and a context re-scan (delta) or full scan that
// registers in the activity dock and refetches on CONTEXT_GEN_COMPLETE.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event } from '@tauri-apps/api/event';

import { scanCodebase } from '@/api/devTools/devTools';
import { getKpiScanStatus, scanKpis } from '@/api/devTools/kpis';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { EventName, type ContextGenCompletePayload } from '@/lib/eventRegistry';
import { useOverviewStore } from '@/stores/overviewStore';
import { toastCatch } from '@/lib/silentCatch';

import type { FactoryL2Data } from './factoryL2Data';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How often the scan's status is read. */
export const KPI_SCAN_POLL_MS = 2_000;
/**
 * The backend gives the scan's CLI stream 900 s (`kpi_scan.rs`, run_kpi_scan's
 * `timeout_duration`) and only then writes `failed`. The poll must outlast that
 * plus spawn and wind-down, or it gives up while the scan is still producing
 * the proposals it was started for (it used to stop after 150 polls, 300 s).
 */
export const KPI_SCAN_POLL_BUDGET_MS = (900 + 60) * 1_000;

/** Statuses after which the backend writes nothing more for this scan. */
const KPI_SCAN_TERMINAL = new Set(['completed', 'failed', 'cancelled', 'not_found']);

export interface KpiScanFinal { status: string; error?: string | null }

/**
 * Poll a KPI scan until the backend reports a terminal status, the budget runs
 * out (`null`) or the caller stops caring (`alive()` false, also `null`).
 */
export async function pollKpiScan(
  scanId: string,
  deps: {
    getStatus: (id: string) => Promise<KpiScanFinal>;
    wait?: (ms: number) => Promise<unknown>;
    alive?: () => boolean;
  },
): Promise<KpiScanFinal | null> {
  const wait = deps.wait ?? sleep;
  const alive = deps.alive ?? (() => true);
  for (let i = 0; i < Math.ceil(KPI_SCAN_POLL_BUDGET_MS / KPI_SCAN_POLL_MS); i++) {
    await wait(KPI_SCAN_POLL_MS);
    if (!alive()) return null;
    const st = await deps.getStatus(scanId);
    if (KPI_SCAN_TERMINAL.has(st.status)) return st;
  }
  return null;
}

export function useFactoryScans(data: FactoryL2Data, onNote: (s: string) => void) {
  const [kpiScanning, setKpiScanning] = useState(false);
  const [ctxScanId, setCtxScanId] = useState<string | null>(null);
  // Leaving the tab stops the status poll; the scan itself runs on.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const scanKpisNow = useCallback(async () => {
    if (!data.project) return;
    setKpiScanning(true);
    try {
      const { scan_id } = await scanKpis(data.project.id);
      const st = await pollKpiScan(scan_id, { getStatus: getKpiScanStatus, alive: () => mounted.current });
      if (!mounted.current) return;
      if (st) onNote(st.status === 'completed' ? 'KPI scan complete. Fresh proposals on the contexts' : st.error ?? 'KPI scan failed');
      data.reloadKpis();
    } catch (e) {
      toastCatch('factory kpi scan')(e);
    } finally {
      setKpiScanning(false);
    }
  }, [data, onNote]);

  const scanContexts = useCallback((delta: boolean) => {
    const p = data.project;
    if (!p) return;
    void scanCodebase(p.id, p.root_path, delta)
      .then(({ scan_id }) => {
        setCtxScanId(scan_id);
        useOverviewStore.getState().processStarted(
          'factory_scan',
          scan_id,
          `Context scan: ${p.name}`,
          { section: 'plugins', tab: 'context-map' },
        );
      })
      .catch(toastCatch('factory context scan'));
  }, [data.project]);

  const onScanComplete = useCallback(
    (event: Event<ContextGenCompletePayload>) => {
      if (!ctxScanId || event.payload.scan_id !== ctxScanId) return;
      setCtxScanId(null);
      onNote(
        event.payload.status === 'completed'
          ? `Scan complete: ${event.payload.groups_created} groups · ${event.payload.contexts_created} contexts · ${event.payload.files_mapped} files mapped`
          : event.payload.error ?? 'Scan failed',
      );
      data.reloadMap();
    },
    [ctxScanId, data, onNote],
  );
  useTauriEvent<ContextGenCompletePayload>(EventName.CONTEXT_GEN_COMPLETE, onScanComplete);

  const scanFeatures = useCallback(() => {
    void data.useCaseState.scan().catch(toastCatch('factory feature scan'));
  }, [data.useCaseState]);

  return { kpiScanning, ctxScanning: ctxScanId !== null, scanKpisNow, scanContexts, scanFeatures };
}
