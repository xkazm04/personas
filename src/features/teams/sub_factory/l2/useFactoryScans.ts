// The L2 Overview's four real scans, moved out of the old Deck toolbar when the
// tab was composed from the kit: Scan for KPIs (polled to completion), Scan
// features (use cases), and a context re-scan (delta) or full scan that
// registers in the activity dock and refetches on CONTEXT_GEN_COMPLETE.
import { useCallback, useState } from 'react';
import type { Event } from '@tauri-apps/api/event';

import { scanCodebase } from '@/api/devTools/devTools';
import { getKpiScanStatus, scanKpis } from '@/api/devTools/kpis';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import { EventName, type ContextGenCompletePayload } from '@/lib/eventRegistry';
import { useOverviewStore } from '@/stores/overviewStore';
import { toastCatch } from '@/lib/silentCatch';

import type { FactoryL2Data } from './factoryL2Data';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useFactoryScans(data: FactoryL2Data, onNote: (s: string) => void) {
  const [kpiScanning, setKpiScanning] = useState(false);
  const [ctxScanId, setCtxScanId] = useState<string | null>(null);

  const scanKpisNow = useCallback(async () => {
    if (!data.project) return;
    setKpiScanning(true);
    try {
      const { scan_id } = await scanKpis(data.project.id);
      for (let i = 0; i < 150; i++) {
        await sleep(2000);
        const st = await getKpiScanStatus(scan_id);
        if (st.status === 'completed' || st.status === 'failed') {
          onNote(st.status === 'completed' ? 'KPI scan complete. Fresh proposals on the contexts' : st.error ?? 'KPI scan failed');
          break;
        }
      }
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
