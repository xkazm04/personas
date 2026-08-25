// The Ship layer's LIVE adapter: fetches dev_milestones (+ members + goals)
// and joins them against the signals FactoryL2Data already carries (contexts,
// use cases, KPIs, runtime errors, sensor wiring) into ShipMilestoneVM shapes.
// All mutations go through the dev_tools_*_milestone* commands and refetch —
// the backend stores decisions, every number on screen derives here.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listGoals, memorySkillContextPairs, type SkillContextPair } from '@/api/devTools/devTools';
import {
  createMilestone, listMilestoneItems, listMilestones, removeMilestoneItem,
  setMilestoneItem, updateMilestone,
  type MilestoneBucket, type MilestoneItemKind, type MilestoneStatus,
} from '@/api/devTools/milestones';
import type { DevGoal } from '@/lib/bindings/DevGoal';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';
import type { DevMilestoneItem } from '@/lib/bindings/DevMilestoneItem';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import type { FactoryL2Data } from '../factoryL2Data';
import { parseStringArray } from '../factoryL2Data';
import { deriveCriteria, type SkillCoverage } from './shipCriteria';
import { deriveFootprint, deriveProgress } from './shipDerive';
import { deriveDuality } from './shipDuality';
import { useShipLiveRevision } from './useShipLive';
import {
  featureState, type ContextTone, type ScopeBucket,
  type ShipContext, type ShipFeature, type ShipGoal, type ShipGoalMember, type ShipGroup,
  type ShipMember, type ShipMilestoneVM,
} from './shipModel';

export interface ShipData {
  loading: boolean;
  /** The raw dev project (root_path for dispatches). Null while loading. */
  project: FactoryL2Data['project'];
  roadmap: ShipMilestoneVM[];
  /** Every context through the Ship lens (health + KPI coverage). */
  contexts: ShipContext[];
  /** Context groups (the library's bands). */
  groups: ShipGroup[];
  /** Refetch milestones + members + goals. */
  reload: () => void;
  /** The full active use-case pool through the Ship lens. */
  features: ShipFeature[];
  goals: ShipGoal[];
  create: (name: string, goal?: string) => void;
  setStatus: (id: string, status: MilestoneStatus) => void;
  /** Rename the milestone's objective line (the `goal` column). */
  /** Rename the milestone's objective TITLE (the `goal` column). */
  setGoal: (id: string, goal: string) => void;
  /** Set the milestone's prose description (the `description` column). */
  setDescription: (id: string, description: string) => void;
  /**
   * Upsert a scope member. `annotations` is a PATCH: pass only the keys that
   * changed. An omitted key leaves the stored column untouched; an explicit
   * `null` clears it.
   */
  setItem: (
    milestoneId: string,
    kind: MilestoneItemKind,
    itemId: string,
    bucket: MilestoneBucket,
    annotations?: { description?: string | null; rating?: number | null },
  ) => void;
  removeItem: (milestoneId: string, kind: MilestoneItemKind, itemId: string) => void;
}

const dateLabel = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function useShipData(data: FactoryL2Data): ShipData {
  const { t, tx } = useTranslation();
  const projectId = data.project?.id ?? null;
  const [milestones, setMilestones] = useState<DevMilestone[]>([]);
  const [itemsByMs, setItemsByMs] = useState<Map<string, DevMilestoneItem[]>>(new Map());
  const [devGoals, setDevGoals] = useState<DevGoal[]>([]);
  // (skill, context) pairs with fresh insight — the `skill-coverage` criterion's
  // only input. Empty is a real answer (no skill has run on this project yet)
  // and the criterion reports it as `setup`, never as a failure.
  const [skillPairs, setSkillPairs] = useState<SkillContextPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  // Writes made OUTSIDE this tab (background agents, Athena, Fleet, CLI ingest)
  // change this number; the fetch effect below lists it, so the planner
  // repaints with no navigation and no timer. See `useShipLive.ts`.
  const liveRevision = useShipLiveRevision();
  // The project this hook has already painted at least once. A REFETCH must
  // not blank a planner that is already showing rows (loading doctrine law 1),
  // and here that is not a nicety: `ShipPlannerTab` returns `LoadingSpinner`
  // while `loading` is true, and that component renders NOTHING. Before live
  // refresh only the tab's own mutations re-ran this effect; now a background
  // agent's write can, so a blank flash per outside write would make the
  // surface the operator is watching unusable. Switching project still ghosts.
  const paintedProject = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    if (paintedProject.current !== projectId) setLoading(true);
    void Promise.all([
      listMilestones(projectId),
      listGoals(projectId),
      // Best effort and deliberately not in the failure path below: skill
      // coverage is ONE criterion's input, and a milestone whose cut and goals
      // loaded fine should not read as a failed load because the memory ledger
      // was unreachable. An empty list degrades that criterion to `setup`.
      memorySkillContextPairs(projectId).catch(() => [] as SkillContextPair[]),
    ])
      .then(async ([ms, gs, pairs]) => {
        const entries = await Promise.all(
          ms.map(async (m) => [m.id, await listMilestoneItems(m.id)] as const),
        );
        if (!alive) return;
        setMilestones(ms);
        setItemsByMs(new Map(entries));
        setDevGoals(gs);
        setSkillPairs(pairs);
        paintedProject.current = projectId;
        setLoading(false);
      })
      .catch((e) => {
        silentCatch('useShipData:load')(e);
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [projectId, nonce, liveRevision]);

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
      return { id: c.id, name: c.name, tone, groupId: c.group_id, files: parseStringArray(c.file_paths), kpis, errors };
    });
  }, [data.contexts, data.kpis, data.monitoringWired, data.runtime.errorsByContext]);

  const groups = useMemo<ShipGroup[]>(
    () => data.groups.map((g) => ({ id: g.id, name: g.name, color: g.color })),
    [data.groups],
  );

  const ctxById = useMemo(() => new Map(contexts.map((c) => [c.id, c])), [contexts]);

  const features = useMemo<ShipFeature[]>(() => {
    return data.useCaseState.active.map((uc) => {
      const slice = uc.context_ids.map((id) => ctxById.get(id)).filter((c): c is ShipContext => Boolean(c));
      const kpiCount = data.kpis.filter(
        (k) => k.status === 'active' && (k.use_case_id === uc.id || (k.context_id && uc.context_ids.includes(k.context_id))),
      ).length;
      const crit = slice.find((c) => c.tone === 'crit') ?? null;
      const st = featureState(t, kpiCount, crit?.name ?? null);
      return {
        id: uc.id,
        name: uc.name,
        contexts: slice.map((c) => c.name),
        contextIds: slice.map((c) => c.id),
        kpiCount,
        ...st,
        blocker: crit ? tx(t.ship.blocker_errors, { name: crit.name, count: crit.errors ?? 0 }) : null,
      };
    });
  }, [data.useCaseState.active, data.kpis, ctxById, t, tx]);

  // Pairs → one entry per skill with the set of contexts it has reached. Built
  // once here rather than inside the per-milestone loop: the pairs are a
  // project-wide fact and every milestone intersects the same map with its own
  // footprint.
  const skillCoverage = useMemo<SkillCoverage[]>(() => {
    const bySkill = new Map<string, Set<string>>();
    for (const p of skillPairs) {
      const set = bySkill.get(p.skill) ?? new Set<string>();
      set.add(p.contextId);
      bySkill.set(p.skill, set);
    }
    return [...bySkill.entries()]
      .map(([skill, contextIds]) => ({ skill, contextIds }))
      .sort((a, b) => b.contextIds.size - a.contextIds.size || a.skill.localeCompare(b.skill));
  }, [skillPairs]);

  const goals = useMemo<ShipGoal[]>(
    () => devGoals
      .filter((g) => g.status !== 'completed' && g.status !== 'archived')
      .map((g) => ({
        id: g.id,
        name: g.title,
        description: g.description,
        status: g.status,
        // Resolve the context BY ID, then carry both the display name and the
        // id: every downstream "does this goal belong to context X" join reads
        // contextIds, never the name (names collide in the generated map).
        contexts: g.context_id && ctxById.has(g.context_id) ? [ctxById.get(g.context_id)!.name] : [],
        contextIds: g.context_id && ctxById.has(g.context_id) ? [g.context_id] : [],
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
        .filter((it) => it.itemKind === 'use_case')
        .map((it) => {
          const feature = featById.get(it.itemId);
          return feature
            ? {
                feature,
                bucket: it.bucket as ScopeBucket,
                afterCut: it.addedAfterCut,
                description: it.description,
                // NEVER coerce a missing rating to 0 — unrated is its own state.
                rating: it.rating,
              }
            : null;
        })
        .filter((x): x is ShipMember => x !== null);
      const goalItems = items.filter((it) => it.itemKind === 'goal');
      const boundGoals = goalItems
        .map((it) => goalById.get(it.itemId))
        .filter((g): g is ShipGoal => Boolean(g));
      // Progress counts the CORE cut only, so goals need their bucket the same
      // way features do. `boundGoals` deliberately stays bucket-blind: it feeds
      // the `objective` exit criterion, which asks whether the milestone has
      // anything to be FOR, and a goal parked in `later` still answers that.
      // The same goals AS MEMBERS — carrying the bucket, the creep flag and the
      // operator's note and rating off their `dev_milestone_items` row. The cut
      // renders these; `boundGoals` above stays membership-free for the
      // criterion that does not care which bucket a goal sits in.
      const goalMembers = goalItems
        .map((it) => {
          const g = goalById.get(it.itemId);
          return g
            ? {
              goal: g,
              bucket: it.bucket as ScopeBucket,
              afterCut: it.addedAfterCut,
              description: it.description,
              rating: it.rating,
            }
            : null;
        })
        .filter((x): x is ShipGoalMember => x !== null);
      const coreGoals = goalMembers
        .filter((gm) => gm.bucket === 'core')
        .map((gm) => gm.goal);

      const core = members.filter((mm) => mm.bucket === 'core');
      const footprint = deriveFootprint(core, contexts);
      const criteria = deriveCriteria({
        row: m,
        core,
        boundGoals,
        footprint,
        monitoringWired: data.monitoringWired,
        llmWired: data.llmWired,
        skillCoverage,
        t,
        tx,
      });

      // Progress counts BOTH member kinds — core features by the automation's
      // reading, core goals by their status. Ratings are reported beside it
      // (deriveDuality) and deliberately do not move this number. See
      // `deriveProgress` for why a goals-only cut used to read 0% forever.
      const progress = m.status === 'shipped' ? 100 : deriveProgress(core, coreGoals);

      return {
        row: m,
        id: m.id,
        name: m.name,
        goal: m.goal,
        description: m.description,
        status: m.status as ShipMilestoneVM['status'],
        targetLabel: m.status === 'shipped'
          ? tx(t.ship.target_shipped, { date: dateLabel(m.shippedAt) ?? '' }).trim()
          : m.targetDate ? tx(t.ship.target_date, { date: m.targetDate }) : null,
        members,
        goalMembers,
        boundGoals,
        footprint,
        skillCoverage,
        criteria,
        progress,
        duality: deriveDuality(core),
      };
    });
  }, [milestones, itemsByMs, features, goals, contexts, data.monitoringWired, data.llmWired, t, tx]);

  // -- mutations (decision writes; everything else re-derives) ----------------

  const create = useCallback((name: string, goal?: string) => {
    if (!projectId) return;
    void createMilestone({ projectId, name, goal }).then(reload).catch(toastCatch('ship create milestone'));
  }, [projectId, reload]);

  const setStatus = useCallback((id: string, status: MilestoneStatus) => {
    void updateMilestone(id, { status }).then(reload).catch(toastCatch('ship milestone status'));
  }, [reload]);

  const setGoal = useCallback((id: string, goal: string) => {
    void updateMilestone(id, { goal }).then(reload).catch(toastCatch('ship milestone goal'));
  }, [reload]);

  const setDescription = useCallback((id: string, description: string) => {
    void updateMilestone(id, { description }).then(reload).catch(toastCatch('ship milestone description'));
  }, [reload]);

  const setItem = useCallback((
    milestoneId: string,
    kind: MilestoneItemKind,
    itemId: string,
    bucket: MilestoneBucket,
    annotations?: { description?: string | null; rating?: number | null },
  ) => {
    void setMilestoneItem(milestoneId, kind, itemId, bucket, annotations)
      .then(reload).catch(toastCatch('ship set scope'));
  }, [reload]);

  const removeItem = useCallback((milestoneId: string, kind: MilestoneItemKind, itemId: string) => {
    void removeMilestoneItem(milestoneId, kind, itemId).then(reload).catch(toastCatch('ship remove scope'));
  }, [reload]);

  // `createFeature`, `scanContexts` and the context-scan listener were removed
  // on 2026-08-24 with the composer's browsable library. Both existed solely
  // for that tree — a per-context quick-add and the uncharted empty state's
  // scan button — and the operator's ruling was that composing a milestone must
  // not require choosing a context at all. Contexts are still scanned from the
  // Factory's own surfaces; recovering these is a `git show` away if a future
  // caller genuinely needs them, and leaving uncalled methods on the hook is
  // the orphan rot this repo measures elsewhere.

  return {
    loading: loading || data.loading,
    project: data.project,
    roadmap, contexts, groups, features, goals, reload,
    create, setStatus, setGoal, setDescription, setItem, removeItem,
  };
}
