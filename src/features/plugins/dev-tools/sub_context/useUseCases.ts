// Use-case slice layer, scoped to the active Dev Tools project.
//
// Deliberately local state rather than a Zustand slice: use cases are only read
// on the Context Map surface today, and the Factory fetches its own copy. If a
// third consumer appears, promote this to `src/stores/slices/system/`.
import { useCallback, useEffect, useRef, useState } from 'react';

import * as api from '@/api/devTools/useCases';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import { silentCatch } from '@/lib/silentCatch';

/** Poll cadence while a proposal scan is in flight. */
const SCAN_POLL_MS = 2_000;

export interface UseCasesState {
  useCases: DevUseCase[];
  /** `status === 'active'` — the project's accepted vocabulary. */
  active: DevUseCase[];
  /** `status === 'proposed'` — the triage queue. */
  proposed: DevUseCase[];
  loading: boolean;
  scanning: boolean;
  /** Last line the running scan emitted, for a live status hint. */
  scanLine: string | null;
  error: string | null;
  reload: () => void;
  scan: () => Promise<void>;
  cancelScan: () => Promise<void>;
  backfill: () => Promise<number>;
  accept: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
}

export function useUseCases(projectId: string | null): UseCasesState {
  const [useCases, setUseCases] = useState<DevUseCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanLine, setScanLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const scanIdRef = useRef<string | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setUseCases([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .listUseCases(projectId)
      .then((rows) => {
        if (!cancelled) {
          setUseCases(rows);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  // Poll the running scan until it settles, then refresh the queue. The scan is
  // a background job, so this survives remounts only for the current session —
  // a missed completion is recovered by the next reload.
  useEffect(() => {
    if (!scanning || !scanIdRef.current) return;
    let cancelled = false;
    const timer = setInterval(() => {
      const id = scanIdRef.current;
      if (!id) return;
      void api
        .getUseCaseScanStatus(id)
        .then((s) => {
          if (cancelled) return;
          const lines = s.lines ?? [];
          setScanLine(lines.length > 0 ? (lines[lines.length - 1] ?? null) : null);
          if (s.status !== 'running') {
            setScanning(false);
            scanIdRef.current = null;
            setScanLine(null);
            if (s.status === 'failed' && s.error) setError(s.error);
            reload();
          }
        })
        .catch((err: unknown) => {
          silentCatch('useUseCases:pollScan')(err);
          if (cancelled) return;
          // The job registry lost the scan (app restart, poisoned lock) — stop
          // polling rather than spin forever.
          setScanning(false);
          scanIdRef.current = null;
        });
    }, SCAN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [scanning, reload]);

  const scan = useCallback(async () => {
    if (!projectId || scanning) return;
    setError(null);
    try {
      const { scan_id } = await api.scanUseCases(projectId);
      scanIdRef.current = scan_id;
      setScanning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, scanning]);

  const cancelScan = useCallback(async () => {
    const id = scanIdRef.current;
    if (!id) return;
    await api.cancelUseCaseScan(id).catch(silentCatch('useUseCases:cancelScan'));
    scanIdRef.current = null;
    setScanning(false);
    setScanLine(null);
    reload();
  }, [reload]);

  const backfill = useCallback(async () => {
    if (!projectId) return 0;
    setError(null);
    try {
      const created = await api.backfillUseCases(projectId);
      reload();
      return created.length;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return 0;
    }
  }, [projectId, reload]);

  // Optimistic status flips: the triage queue should feel instant.
  const setStatus = useCallback(
    async (id: string, status: 'active' | 'archived') => {
      setUseCases((prev) => prev.map((u) => (u.id === id ? { ...u, status } : u)));
      try {
        await api.updateUseCase(id, { status });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        reload();
      }
    },
    [reload],
  );

  const accept = useCallback((id: string) => setStatus(id, 'active'), [setStatus]);
  const reject = useCallback((id: string) => setStatus(id, 'archived'), [setStatus]);

  return {
    useCases,
    active: useCases.filter((u) => u.status === 'active'),
    proposed: useCases.filter((u) => u.status === 'proposed'),
    loading,
    scanning,
    scanLine,
    error,
    reload,
    scan,
    cancelScan,
    backfill,
    accept,
    reject,
  };
}
