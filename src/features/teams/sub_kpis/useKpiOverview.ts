// Data for the strategic overviews. The overview needs ONLY the KPI rows
// (band and coverage come from `current_value`), plus the context groups of
// every project that has active KPIs. Groups are project-scoped in Rust, so
// this hook fans out one read per project and keeps its own map — the store's
// `contextGroups` slice backs the Context tab and must not be clobbered.
// Measurements load LAZILY through `useLazyTrends`, only for the ids a
// variant or the layer actually shows.
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevKpiMeasurement } from '@/lib/bindings/DevKpiMeasurement';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import * as kpiApi from '@/api/devTools/kpis';

import { buildOverview, type KpiProjectRollup } from './kpiOverviewModel';

const EMPTY_SET: ReadonlySet<string> = new Set();

export function useKpiOverview(): { overview: KpiProjectRollup[]; loading: boolean } {
  const { t } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const projects = useSystemStore((s) => s.projects);
  const kpisLoading = useSystemStore((s) => s.kpisLoading);

  const projectIdsKey = useMemo(
    () => [...new Set(kpis.filter((k) => k.status === 'active').map((k) => k.project_id))].sort().join(','),
    [kpis],
  );
  const [groups, setGroups] = useState<DevContextGroup[]>([]);
  const [failed, setFailed] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [groupsLoading, setGroupsLoading] = useState(false);

  useEffect(() => {
    if (!projectIdsKey) return;
    let cancelled = false;
    setGroupsLoading(true);
    const ids = projectIdsKey.split(',');
    // A failed read is not a grade: the project is remembered as `failed` so
    // its lane says "groups unknown" instead of collapsing into one cell.
    void mapWithConcurrency(ids, 4, async (projectId) => {
        try {
          const rows = await invokeWithTimeout<DevContextGroup[]>('dev_tools_list_context_groups', { projectId });
          return { projectId, rows };
        } catch (err) {
          silentCatch('kpi overview: list_context_groups')(err);
          return { projectId, rows: null };
        }
      }).then((results) => {
      if (cancelled) return;
      setGroups(results.flatMap((r) => r.rows ?? []));
      setFailed(new Set(results.filter((r) => r.rows === null).map((r) => r.projectId)));
      setGroupsLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectIdsKey]);

  const overview = useMemo(
    () => buildOverview(kpis, projects, groups, t.kpis.overview.ungrouped, failed),
    [kpis, projects, groups, failed, t],
  );
  return { overview, loading: kpisLoading || groupsLoading };
}

export type LazyTrendsStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Measurements for exactly `ids`, fetched when the set changes. Results stay
 * local to the caller (no store write), so two variants never fight over one
 * map. `perKpi` defaults to the newest 30 points, which the sampler then
 * buckets; `retry` re-issues the same read.
 */
export function useLazyTrends(
  ids: string[],
  perKpi = 30,
): { trends: Record<string, DevKpiMeasurement[]>; status: LazyTrendsStatus; retry: () => void } {
  const key = useMemo(() => [...ids].sort().join(','), [ids]);
  const [state, setState] = useState<{ key: string; trends: Record<string, DevKpiMeasurement[]>; status: LazyTrendsStatus }>({
    key: '',
    trends: {},
    status: 'idle',
  });
  const [attempt, setAttempt] = useState(0);
  const inflight = useRef<string>('');

  useEffect(() => {
    if (!key) return;
    const token = `${key}#${attempt}`;
    inflight.current = token;
    setState((s) => (s.key === key ? { ...s, status: 'loading' } : { key, trends: {}, status: 'loading' }));
    kpiApi
      .listKpiMeasurementsBulk(key.split(','), perKpi)
      .then((rows) => {
        if (inflight.current !== token) return;
        const trends: Record<string, DevKpiMeasurement[]> = {};
        for (const m of rows) (trends[m.kpi_id] ??= []).push(m);
        setState({ key, trends, status: 'ready' });
      })
      .catch((err: unknown) => {
        if (inflight.current !== token) return;
        silentCatch('kpi overview: measurements bulk')(err);
        setState({ key, trends: {}, status: 'failed' });
      });
  }, [key, perKpi, attempt]);

  const retry = () => setAttempt((n) => n + 1);
  const empty = !key;
  return {
    trends: empty ? {} : state.trends,
    status: empty ? 'idle' : state.status,
    retry,
  };
}
