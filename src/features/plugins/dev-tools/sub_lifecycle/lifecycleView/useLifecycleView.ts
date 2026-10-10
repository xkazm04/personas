/**
 * The Lifecycle surface's whole data model: one snapshot, the derived lanes,
 * the selected step, the OPEN step (Layer 2), the headline, and the install /
 * Ask-Athena actions. The headline and the install live in their own hooks
 * (`useLifecycleHeadline`, `useLifecycleInstall`); this file composes them.
 *
 * Two pieces of navigation state, deliberately separate:
 *
 * - `selected` is the rail's roving cursor (the key that owns the tab stop,
 *   moved by the arrow keys). It is pre-seeded to the weakest step.
 * - `openStepId` is the step whose Layer-2 screen replaces Layer 1 in the same
 *   page (not a modal, not a route). Opening a step also selects it, so
 *   closing returns the cursor to the key that was opened.
 *
 * The model is ONE memoised object: every block reads it through one context,
 * so a page render that changed nothing in it (a revalidation that brought the
 * same snapshot back) re-renders no block. `loading` is the FIRST load only,
 * for the same reason.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import { useSystemStore } from '@/stores/systemStore';

import { authorLabel, bindingKindLabel, presetLabel, stepLabel } from '../journey/journeyLabels';
import { buildLanes, installInFlight, missingBindings, weakest } from '../journey/journeyModel';
import type { JourneyLanes, JourneyNode } from '../journey/journeyModel';
import { useLifecycleSnapshot } from '../journey/useLifecycleSnapshot';
import { freshnessOf, type Freshness } from './frame/freshness';
import { useLifecycleHeadline } from './useLifecycleHeadline';
import { useLifecycleInstall, type InstallNote } from './useLifecycleInstall';

const EMPTY_LANES: JourneyLanes = { before: [], after: [] };
const NO_EVIDENCE: LifecycleEvidenceItem[] = [];

/**
 * A part of a step's screen another surface (or the screen's own Next panel)
 * can ask it to open: `commands` the Gate / Tests Commands editor, `coverage`
 * that editor with a coverage row ready to fill, `run:<commandId>` that
 * command's row, scrolled to with its first error open.
 */
export type StepFocus = 'commands' | 'coverage' | `run:${string}`;

/**
 * The step last opened per project, this session (module memory, never
 * persisted): coming back to the page re-selects it on the rail. Bounded by
 * the projects visited; cleared past the cap.
 */
const lastOpened = new Map<string, string>();
const LAST_OPENED_CAP = 64;

/** Test-only: forget the remembered steps. */
export function __resetLastOpenedForTests(): void {
  lastOpened.clear();
}

export interface LifecycleViewModel {
  t: ReturnType<typeof useTranslation>['t'];
  tx: ReturnType<typeof useTranslation>['tx'];
  /** `t.plugins.dev_lifecycle`, the surface's own namespace. */
  dl: ReturnType<typeof useTranslation>['t']['plugins']['dev_lifecycle'];
  projectId: string | null;
  projectName: string | null;
  /** The snapshot for the ACTIVE project only; a stale project's copy reads null. */
  snapshot: LifecycleSnapshot | null;
  /** A first load is in flight with nothing to show (a revalidation behind a shown snapshot is not loading). */
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** "Solo practice, v2 by Athena"; null until the snapshot is in. */
  practice: string | null;
  /** How fresh the measurement is against the base branch; null with no snapshot or no base branch. */
  freshness: Freshness | null;
  lanes: JourneyLanes;
  /** Both lanes in journey order: the one sequence selection and keys walk. */
  order: JourneyNode[];
  evidence: LifecycleEvidenceItem[];
  /** The rail's roving cursor. Null only while there are no steps. */
  selected: JourneyNode | null;
  select: (stepId: string) => void;
  /** The step whose Layer-2 screen is showing, or null for Layer 1. */
  openStepId: string | null;
  /**
   * Show a step's Layer-2 screen in place of Layer 1 (and select it). `focus`
   * asks the screen to open one of its parts on arrival (`commands`: the
   * Gate / Tests Commands editor, from Measure's "nothing to measure").
   */
  openStep: (stepId: string, focus?: StepFocus) => void;
  /** The part the open screen was asked to open on arrival; null once it did (`clearStepFocus`). */
  stepFocus: StepFocus | null;
  clearStepFocus: () => void;
  /** Back to Layer 1; the page restores focus to the step's key. */
  closeStep: () => void;
  /** The weakest-step sentence (by measured health), or the fallback / all-green line. */
  headline: string;
  /** The measured verdict the headline reports, so the plate can ink it. */
  headlineHealth: LifecycleHealth | null;
  /** The binding state the FALLBACK headline reports (no health rows at all). */
  headlineState: LifecycleBindingState | null;
  missingText: string;
  missingCount: number;
  installing: boolean;
  install: () => Promise<void>;
  /** What the last install attempt came to, said inline beside the action. */
  installNote: InstallNote | null;
  askAthena: () => void;
}

export function useLifecycleView(): LifecycleViewModel {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const projectId = useSystemStore((s) => s.activeProjectId);
  const project = useSystemStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const ask = useAskAthena();
  const { snapshot, loading, error, refetch } = useLifecycleSnapshot(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openStepId, setOpenStepId] = useState<string | null>(null);
  const [stepFocus, setStepFocus] = useState<StepFocus | null>(null);

  const current = snapshot && snapshot.projectId === projectId ? snapshot : null;
  const { forcePending, note: installNote, install } = useLifecycleInstall(dl, tx, projectId, current, refetch);
  const lanes = useMemo(() => (current ? buildLanes(current, forcePending) : EMPTY_LANES), [current, forcePending]);
  const order = useMemo(() => [...lanes.before, ...lanes.after], [lanes]);
  const weak = useMemo(() => (current ? weakest(current) : null), [current]);
  const missing = useMemo(() => (current ? missingBindings(current) : []), [current]);
  const head = useLifecycleHeadline(dl, tx, current, order);

  // A project switch clears the selection and leaves any open step.
  useEffect(() => {
    setSelectedId(null);
    setOpenStepId(null);
    setStepFocus(null);
  }, [projectId]);

  const selected = useMemo(() => {
    if (order.length === 0) return null;
    const hit = selectedId ? order.find((n) => n.id === selectedId) : undefined;
    const seed = (projectId ? lastOpened.get(projectId) : undefined) ?? head.headlineStepId ?? weak?.node.id;
    return hit ?? order.find((n) => n.id === seed) ?? order[0] ?? null;
  }, [order, selectedId, weak, head.headlineStepId, projectId]);

  const select = useCallback((stepId: string) => setSelectedId(stepId), []);
  const openStep = useCallback((stepId: string, focus?: StepFocus) => {
    if (projectId) {
      if (lastOpened.size >= LAST_OPENED_CAP) lastOpened.clear();
      lastOpened.set(projectId, stepId);
    }
    setSelectedId(stepId);
    setOpenStepId(stepId);
    setStepFocus(focus ?? null);
  }, [projectId]);
  const closeStep = useCallback(() => {
    setOpenStepId(null);
    setStepFocus(null);
  }, []);
  const clearStepFocus = useCallback(() => setStepFocus(null), []);

  const practice = useMemo(() => (current
    ? current.version === 0
      ? tx(dl.lc_subtitle_default, { preset: presetLabel(dl, current.preset) })
      : tx(dl.lc_subtitle_version, {
          preset: presetLabel(dl, current.preset),
          version: current.version,
          author: authorLabel(dl, current.author) ?? '',
        })
    : null), [current, dl, tx]);
  const freshness = useMemo(() => (current ? freshnessOf(current.tip) : null), [current]);

  const askAthena = useCallback(() => {
    if (!project) return;
    const named = head.headlineStepId ? order.find((n) => n.id === head.headlineStepId) : undefined;
    const text = named
      ? tx(dl.lc_ask_athena_prompt_weakest, {
          name: project.name, id: project.id, step: stepLabel(dl, named.id, named.label),
        })
      : tx(dl.lc_ask_athena_prompt, { name: project.name, id: project.id });
    ask('lifecycle', text);
  }, [project, head.headlineStepId, order, tx, dl, ask]);

  const cold = loading && !current;
  const missingText = useMemo(
    () => missing.map((m) => `${stepLabel(dl, m.stepId, m.label)} (${bindingKindLabel(dl, m.kind)})`).join(', '),
    [missing, dl],
  );
  const installing = forcePending || (current ? installInFlight(current) : false);
  const projectName = project?.name ?? null;
  return useMemo<LifecycleViewModel>(() => ({
    t, tx, dl,
    projectId,
    projectName,
    snapshot: current,
    loading: cold, error, refetch,
    practice,
    freshness,
    lanes, order,
    evidence: current?.evidence ?? NO_EVIDENCE,
    selected, select,
    openStepId, openStep, closeStep, stepFocus, clearStepFocus,
    headline: head.headline,
    headlineHealth: head.headlineHealth,
    headlineState: head.headlineState,
    missingText,
    missingCount: missing.length,
    installing,
    install,
    installNote,
    askAthena,
  }), [
    t, tx, dl, projectId, projectName, current, cold, error, refetch, practice, freshness, lanes, order,
    selected, select, openStepId, openStep, closeStep, stepFocus, clearStepFocus, head, missingText, missing.length,
    installing, install, installNote, askAthena,
  ]);
}
