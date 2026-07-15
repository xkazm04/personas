// Data layer for the Factory's SECOND LEVEL (the per-project tabs).
//
// Everything here is fetched LOCALLY (direct APIs + local state), never through
// the systemStore fetchers — those write global `contexts` / `contextGroups` /
// `kpis` arrays that the Dev Tools modules (the dual-run originals) also read,
// and the Factory must not clobber another module's active-project state.
import { useCallback, useEffect, useMemo, useState } from 'react';

import { listContextGroups, listContexts, listProjects } from '@/api/devTools/devTools';
import { listKpis } from '@/api/devTools/kpis';
import type { DevContext } from '@/lib/bindings/DevContext';
import type { DevContextGroup } from '@/lib/bindings/DevContextGroup';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevProject } from '@/lib/bindings/DevProject';
import {
  buildKpiStatusByContext,
  type ContextKpiStatus,
} from '@/features/plugins/dev-tools/sub_context/contextKpiStatus';
import { useContextRuntime, type ContextRuntime } from '@/features/plugins/dev-tools/sub_context/useContextRuntime';
import { useUseCases, type UseCasesState } from '@/features/plugins/dev-tools/sub_context/useUseCases';
import { silentCatch } from '@/lib/silentCatch';

/** Parse a JSON string-array column tolerantly (contexts store file_paths as JSON). */
export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface FactoryL2Data {
  /** The raw dev project (credential bindings live here). Null while loading. */
  project: DevProject | null;
  groups: DevContextGroup[];
  contexts: DevContext[];
  /** All non-archived KPIs of the project (any status). */
  kpis: DevKpi[];
  useCaseState: UseCasesState;
  runtime: ContextRuntime;
  kpiStatusByContext: Map<string, ContextKpiStatus>;
  /** contextId → number of active use cases slicing it. */
  featureCountByContext: Map<string, number>;
  loading: boolean;
  reloadKpis: () => void;
  /** True when the project has an LLM tracker / monitoring connector bound. */
  llmWired: boolean;
  monitoringWired: boolean;
}

export function useFactoryL2Data(projectId: string): FactoryL2Data {
  const [project, setProject] = useState<DevProject | null>(null);
  const [groups, setGroups] = useState<DevContextGroup[]>([]);
  const [contexts, setContexts] = useState<DevContext[]>([]);
  const [kpis, setKpis] = useState<DevKpi[]>([]);
  const [loading, setLoading] = useState(true);
  const [kpiNonce, setKpiNonce] = useState(0);

  const useCaseState = useUseCases(projectId);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void Promise.all([listProjects(), listContextGroups(projectId), listContexts(projectId)])
      .then(([projects, gs, cs]) => {
        if (!alive) return;
        setProject(projects.find((p) => p.id === projectId) ?? null);
        setGroups(gs);
        setContexts(cs);
        setLoading(false);
      })
      .catch((e) => {
        silentCatch('factoryL2:load')(e);
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    void listKpis(projectId)
      .then((ks) => { if (alive) setKpis(ks.filter((k) => k.status !== 'archived')); })
      .catch(silentCatch('factoryL2:kpis'));
    return () => { alive = false; };
  }, [projectId, kpiNonce]);

  const reloadKpis = useCallback(() => setKpiNonce((n) => n + 1), []);

  const runtimeContexts = useMemo(
    () => contexts.map((c) => ({ id: c.id, filePaths: parseStringArray(c.file_paths) })),
    [contexts],
  );
  const runtime = useContextRuntime(project, useCaseState.useCases, runtimeContexts);

  const kpiStatusByContext = useMemo(() => buildKpiStatusByContext(kpis), [kpis]);

  const featureCountByContext = useMemo(() => {
    const m = new Map<string, number>();
    for (const uc of useCaseState.active) {
      for (const cid of uc.context_ids) m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [useCaseState.active]);

  return {
    project,
    groups,
    contexts,
    kpis,
    useCaseState,
    runtime,
    kpiStatusByContext,
    featureCountByContext,
    loading,
    reloadKpis,
    llmWired: Boolean(project?.llm_tracking_credential_id),
    monitoringWired: Boolean(project?.monitoring_credential_id),
  };
}
