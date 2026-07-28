// The Ship layer's LIVE adapter: fetches dev_milestones (+ members + goals)
// and joins them against the signals FactoryL2Data already carries (contexts,
// use cases, KPIs, runtime errors, sensor wiring) into ShipMilestoneVM shapes.
// All mutations go through the dev_tools_*_milestone* commands and refetch —
// the backend stores decisions, every number on screen derives here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Event } from '@tauri-apps/api/event';

import { listGoals, scanCodebase } from '@/api/devTools/devTools';
import {
  createMilestone, listMilestoneItems, listMilestones, removeMilestoneItem,
  setMilestoneItem, updateMilestone,
  type MilestoneBucket, type MilestoneItemKind, type MilestoneStatus,
} from '@/api/devTools/milestones';
import { createUseCase } from '@/api/devTools/useCases';
import { useTauriEvent } from '@/hooks/useTauriEvent';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';
import type { DevMilestoneItem } from '@/lib/bindings/DevMilestoneItem';
import { EventName, type ContextGenCompletePayload } from '@/lib/eventRegistry';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useOverviewStore } from '@/stores/overviewStore';

import type { FactoryL2Data } from '../factoryL2Data';
import {
  featureState, type ContextTone, type ExitCriterion, type ScopeBucket,
  type ShipContext, type ShipFeature, type ShipGoal, type ShipMember,
  type ShipMilestoneVM,
} from './shipModel';

export interface ShipData {
  loading: boolean;
  roadmap: ShipMilestoneVM[];
  /** Every context through the Ship lens (health + KPI coverage). */
  contexts: ShipContext[];
  /** The full active use-case pool through the Ship lens. */
  features: ShipFeature[];
  goals: ShipGoal[];
  create: (name: string, goal?: string) => void;
  setStatus: (id: string, status: MilestoneStatus) => void;
  setItem: (milestoneId: string, kind: MilestoneItemKind, itemId: string, bucket: MilestoneBucket) => void;
  removeItem: (milestoneId: string, kind: MilestoneItemKind, itemId: string) => void;
  /** Hand-add a use case under a context (the composer's quick-add). */
  createFeature: (contextId: string, name: string) => void;
  /** Kick a full context scan (the no-contexts empty state's follow-up). */
  scanContexts: () => void;
  ctxScanning: boolean;
}

const dateLabel = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function useShipData(data: FactoryL2Data): ShipData {
  const projectId = data.project?.id ?? null;
  const [milestones, setMilestones] = useState<DevMilestone[]>([]);
  const [itemsByMs, setItemsByMs] = useState<Map<string, DevMilestoneItem[]>>(new Map());
  const [devGoals, setDevGoals] = useState<DevGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    void Promise.all([listMilestones(projectId), listGoals(projectId)])
      .then(async ([ms, gs]) => {
        const entries = await Promise.all(
          ms.map(async (m) => [m.id, await listMilestoneItems(m.id)] as const),
        );
        if (!alive) return;
        setMilestones(ms);
        setItemsByMs(new Map(entries));
        setDevGoals(gs);
        setLoading(false);
      })
      .catch((e) => {
        silentCatch('useShipData:load')(e);
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [projectId, nonce]);

  // -- the Ship lens over contexts / use cases / goals ------------------------

  const contexts = useMemo<ShipContext[]>(() => {
    const kpisByCtx = new Map<string, number>();
    for (const k of data.kpis) {
      if (k.status !== 'active' || !k.context_id) continue;
      kpisByCtx.set(k.context_id, (kpisByCtx.get(k.context_id) ?? 0) + 1);
    }
    return data.contexts.map((c) => {
      const errors = data.monitoringWired ? data.runtime.errorsByContext.get(c.id) ?? 0 : null;
      const kpis = kpisByCtx.get(c.id) ?? 0;
      const tone: ContextTone =
        errors !== null && errors >= 25 ? 'crit'
        : errors !== null && errors > 0 ? 'warn'
        : kpis === 0 ? 'setup'
        : 'ok';
      return { id: c.id, name: c.name, tone, kpis, errors };
    });
  }, [data.contexts, data.kpis, data.monitoringWired, data.runtime.errorsByContext]);

  const ctxById = useMemo(() => new Map(contexts.map((c) => [c.id, c])), [contexts]);

  const features = useMemo<ShipFeature[]>(() => {
    return data.useCaseState.active.map((uc) => {
      const slice = uc.context_ids.map((id) => ctxById.get(id)).filter((c): c is ShipContext => Boolean(c));
      const kpiCount = data.kpis.filter(
        (k) => k.status === 'active' && (k.use_case_id === uc.id || (k.context_id && uc.context_ids.includes(k.context_id))),
      ).length;
      const crit = slice.find((c) => c.tone === 'crit') ?? null;
      const st = featureState(kpiCount, crit?.name ?? null);
      return {
        id: uc.id,
        name: uc.name,
        contexts: slice.map((c) => c.name),
        kpiCount,
        ...st,
        blocker: crit ? `${crit.name}: ${crit.errors} errors this week` : null,
      };
    });
  }, [data.useCaseState.active, data.kpis, ctxById]);

  const goals = useMemo<ShipGoal[]>(
    () => devGoals
      .filter((g) => g.status !== 'completed' && g.status !== 'archived')
      .map((g) => ({
        id: g.id,
        name: g.title,
        contexts: g.context_id ? [ctxById.get(g.context_id)?.name ?? ''].filter(Boolean) : [],
      })),
    [devGoals, ctxById],
  );

  // -- milestone view models --------------------------------------------------

  const roadmap = useMemo<ShipMilestoneVM[]>(() => {
    const featById = new Map(features.map((f) => [f.id, f]));
    const goalById = new Map(goals.map((g) => [g.id, g]));

    return milestones.map((m) => {
      const items = itemsByMs.get(m.id) ?? [];
      const members: ShipMember[] = items
        .filter((it) => it.item_kind === 'use_case')
        .map((it) => {
          const feature = featById.get(it.item_id);
          return feature
            ? { feature, bucket: it.bucket as ScopeBucket, afterCut: it.added_after_cut }
            : null;
        })
        .filter((x): x is ShipMember => x !== null);
      const boundGoals = items
        .filter((it) => it.item_kind === 'goal')
        .map((it) => goalById.get(it.item_id))
        .filter((g): g is ShipGoal => Boolean(g));

      const core = members.filter((mm) => mm.bucket === 'core');
      const fpNames = [...new Set(core.flatMap((mm) => mm.feature.contexts))];
      const footprint = fpNames
        .map((name) => contexts.find((c) => c.name === name))
        .filter((c): c is ShipContext => Boolean(c));

      const healthy = footprint.filter((c) => c.tone === 'ok').length;
      const covered = footprint.filter((c) => c.kpis > 0).length;
      const sensors = (data.monitoringWired ? 1 : 0) + (data.llmWired ? 1 : 0);
      const criteria: ExitCriterion[] = [
        {
          id: 'contexts',
          label: 'Core contexts healthy',
          evidence: footprint.length === 0
            ? 'No core scope yet — compose the cut first'
            : `${healthy} of ${footprint.length} in-scope contexts healthy${footprint.some((c) => c.tone === 'crit') ? ` · critical: ${footprint.filter((c) => c.tone === 'crit').map((c) => c.name).join(', ')}` : ''}`,
          done: healthy,
          total: footprint.length,
          state: footprint.length === 0 ? 'setup'
            : footprint.some((c) => c.tone === 'crit') ? 'nogo'
            : healthy < footprint.length ? 'warn' : 'go',
        },
        {
          id: 'kpi',
          label: 'KPI coverage on core scope',
          evidence: footprint.length === 0
            ? 'Coverage derives once the cut has members'
            : `${covered} of ${footprint.length} core contexts carry an active KPI`,
          done: covered,
          total: footprint.length,
          state: footprint.length === 0 ? 'setup' : covered === footprint.length ? 'go' : 'warn',
        },
        {
          id: 'objective',
          label: 'Objective bound',
          evidence: boundGoals.length > 0
            ? boundGoals.map((g) => g.name).join(' · ')
            : 'Bind a measurable goal from the composer',
          done: boundGoals.length > 0 ? 1 : 0,
          total: 1,
          state: boundGoals.length > 0 ? 'go' : 'setup',
        },
        {
          id: 'sensors',
          label: 'Sensors wired',
          evidence: sensors === 2 ? 'Monitoring + LLM tracking both report' : 'Bind monitoring / LLM connectors in Observability',
          done: sensors,
          total: 2,
          state: sensors === 2 ? 'go' : 'setup',
        },
      ];

      const ready = core.filter((mm) => mm.feature.ready).length;
      const progress = m.status === 'shipped'
        ? 100
        : core.length === 0 ? 0 : Math.round((ready / core.length) * 100);

      return {
        row: m,
        id: m.id,
        name: m.name,
        goal: m.goal,
        status: m.status as ShipMilestoneVM['status'],
        targetLabel: m.status === 'shipped'
          ? `shipped ${dateLabel(m.shipped_at) ?? ''}`.trim()
          : m.target_date ? `target ${m.target_date}` : null,
        members,
        boundGoals,
        footprint,
        criteria,
        progress,
      };
    });
  }, [milestones, itemsByMs, features, goals, contexts, data.monitoringWired, data.llmWired]);

  // -- mutations (decision writes; everything else re-derives) ----------------

  const create = useCallback((name: string, goal?: string) => {
    if (!projectId) return;
    void createMilestone({ projectId, name, goal }).then(reload).catch(toastCatch('ship create milestone'));
  }, [projectId, reload]);

  const setStatus = useCallback((id: string, status: MilestoneStatus) => {
    void updateMilestone(id, { status }).then(reload).catch(toastCatch('ship milestone status'));
  }, [reload]);

  const setItem = useCallback((milestoneId: string, kind: MilestoneItemKind, itemId: string, bucket: MilestoneBucket) => {
    void setMilestoneItem(milestoneId, kind, itemId, bucket).then(reload).catch(toastCatch('ship set scope'));
  }, [reload]);

  const removeItem = useCallback((milestoneId: string, kind: MilestoneItemKind, itemId: string) => {
    void removeMilestoneItem(milestoneId, kind, itemId).then(reload).catch(toastCatch('ship remove scope'));
  }, [reload]);

  const createFeature = useCallback((contextId: string, name: string) => {
    if (!projectId) return;
    void createUseCase({ projectId, name, contextIds: [contextId], primaryContextId: contextId, status: 'active' })
      .then(() => data.useCaseState.reload())
      .catch(toastCatch('ship create use case'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, data.useCaseState.reload]);

  // Context scan — the no-contexts empty state's follow-up. Registers in the
  // activity dock and refetches the map when CONTEXT_GEN_COMPLETE lands.
  const [ctxScanId, setCtxScanId] = useState<string | null>(null);
  const scanContexts = useCallback(() => {
    const p = data.project;
    if (!p) return;
    void scanCodebase(p.id, p.root_path, false)
      .then(({ scan_id }) => {
        setCtxScanId(scan_id);
        useOverviewStore.getState().processStarted(
          'factory_scan',
          scan_id,
          `Context scan: ${p.name}`,
          { section: 'plugins', tab: 'context-map' },
        );
      })
      .catch(toastCatch('ship context scan'));
  }, [data.project]);
  const onScanComplete = useCallback((event: Event<ContextGenCompletePayload>) => {
    if (!ctxScanId || event.payload.scan_id !== ctxScanId) return;
    setCtxScanId(null);
    data.reloadMap();
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxScanId, data.reloadMap, reload]);
  useTauriEvent<ContextGenCompletePayload>(EventName.CONTEXT_GEN_COMPLETE, onScanComplete);

  return {
    loading: loading || data.loading,
    roadmap, contexts, features, goals,
    create, setStatus, setItem, removeItem,
    createFeature, scanContexts, ctxScanning: ctxScanId !== null,
  };
}
