// The L2 Overview's four real scans, moved out of the old Deck toolbar when the
// tab was composed from the kit: Scan for KPIs (polled to completion), Scan
// features (use cases), and a context re-scan (delta) or full scan that
// registers in the activity dock and refetches on CONTEXT_GEN_COMPLETE.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event } from '@tauri-apps/api/event';

import { scanCodebase } from '@/api/devTools/devTools';
import { cancelKpiScan, getKpiScanStatus, scanKpis } from '@/api/devTools/kpis';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { EventName, type ContextGenCompletePayload } from '@/lib/eventRegistry';
import { useOverviewStore } from '@/stores/overviewStore';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { getActiveTranslations, interpolate } from '@/i18n/useTranslation';

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

/** The note a finished KPI scan leaves; a cancelled one is not a failure. */
export function kpiScanNote(st: KpiScanFinal): string {
  const k = getActiveTranslations().kpis;
  if (st.status === 'completed') return k.scan_note_complete;
  if (st.status === 'cancelled') return k.scan_note_cancelled;
  return st.error ?? k.scan_note_failed;
}

export function useFactoryScans(data: FactoryL2Data, onNote: (s: string) => void) {
  const [kpiScanning, setKpiScanning] = useState(false);
  const kpiScanId = useRef<string | null>(null);
  const [ctxScanId, setCtxScanId] = useState<string | null>(null);
  // Leaving the tab stops the status poll; the scan itself runs on.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** Scan for KPI proposals: the whole project, or one context when `contextId` is given. */
  const scanKpisNow = useCallback(async (contextId?: string) => {
    if (!data.project) return;
    setKpiScanning(true);
    try {
      const { scan_id } = await scanKpis(data.project.id, contextId);
      kpiScanId.current = scan_id;
      const st = await pollKpiScan(scan_id, { getStatus: getKpiScanStatus, alive: () => mounted.current });
      if (!mounted.current) return;
      if (st) onNote(kpiScanNote(st));
      data.reloadKpis();
    } catch (e) {
      toastCatch('factory kpi scan')(e);
    } finally {
      kpiScanId.current = null;
      setKpiScanning(false);
    }
  }, [data, onNote]);

  /** Stop the running KPI scan; the status poll then reads `cancelled` and ends. */
  const cancelKpiScanNow = useCallback(() => {
    const id = kpiScanId.current;
    if (id) void cancelKpiScan(id).catch(silentCatch('useFactoryScans:cancelKpiScan'));
  }, []);

  const scanContexts = useCallback((delta: boolean) => {
    const p = data.project;
    if (!p) return;
    void scanCodebase(p.id, p.root_path, delta)
      .then(({ scan_id }) => {
        setCtxScanId(scan_id);
        useOverviewStore.getState().processStarted(
          'factory_scan',
          scan_id,
          interpolate(getActiveTranslations().kpis.ctx_scan_process_title, { name: p.name }),
          { section: 'plugins', tab: 'context-map' },
        );
      })
      .catch(toastCatch('factory context scan'));
  }, [data.project]);

  const onScanComplete = useCallback(
    (event: Event<ContextGenCompletePayload>) => {
      if (!ctxScanId || event.payload.scan_id !== ctxScanId) return;
      setCtxScanId(null);
      const k = getActiveTranslations().kpis;
      onNote(
        event.payload.status === 'completed'
          ? interpolate(k.ctx_scan_note_complete, {
              groups: event.payload.groups_created,
              contexts: event.payload.contexts_created,
              files: event.payload.files_mapped,
            })
          : event.payload.error ?? k.ctx_scan_note_failed,
      );
      data.reloadMap();
    },
    [ctxScanId, data, onNote],
  );
  useTauriEvent<ContextGenCompletePayload>(EventName.CONTEXT_GEN_COMPLETE, onScanComplete);

  const scanFeatures = useCallback(() => {
    void data.useCaseState.scan().catch(toastCatch('factory feature scan'));
  }, [data.useCaseState]);

  return { kpiScanning, ctxScanning: ctxScanId !== null, scanKpisNow, cancelKpiScanNow, scanContexts, scanFeatures };
}
