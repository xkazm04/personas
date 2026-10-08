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
import { useLifecycleHeadline } from './useLifecycleHeadline';
import { useLifecycleInstall, type InstallNote } from './useLifecycleInstall';

const EMPTY_LANES: JourneyLanes = { before: [], after: [] };

export interface LifecycleViewModel {
  t: ReturnType<typeof useTranslation>['t'];
  tx: ReturnType<typeof useTranslation>['tx'];
  /** `t.plugins.dev_lifecycle`, the surface's own namespace. */
  dl: ReturnType<typeof useTranslation>['t']['plugins']['dev_lifecycle'];
  projectId: string | null;
  projectName: string | null;
  /** The snapshot for the ACTIVE project only; a stale project's copy reads null. */
  snapshot: LifecycleSnapshot | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  subtitle: string;
  lanes: JourneyLanes;
  /** Both lanes in journey order: the one sequence selection and keys walk. */
  order: JourneyNode[];
  evidence: LifecycleEvidenceItem[];
  /** The rail's roving cursor. Null only while there are no steps. */
  selected: JourneyNode | null;
  select: (stepId: string) => void;
  /** The step whose Layer-2 screen is showing, or null for Layer 1. */
  openStepId: string | null;
  /** Show a step's Layer-2 screen in place of Layer 1 (and select it). */
  openStep: (stepId: string) => void;
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
  }, [projectId]);

  const selected = useMemo(() => {
    if (order.length === 0) return null;
    const hit = selectedId ? order.find((n) => n.id === selectedId) : undefined;
    const seed = head.headlineStepId ?? weak?.node.id;
    return hit ?? order.find((n) => n.id === seed) ?? order[0] ?? null;
  }, [order, selectedId, weak, head.headlineStepId]);

  const select = useCallback((stepId: string) => setSelectedId(stepId), []);
  const openStep = useCallback((stepId: string) => {
    setSelectedId(stepId);
    setOpenStepId(stepId);
  }, []);
  const closeStep = useCallback(() => setOpenStepId(null), []);

  const subtitle = current
    ? current.version === 0
      ? tx(dl.lc_subtitle_default, { preset: presetLabel(dl, current.preset) })
      : tx(dl.lc_subtitle_version, {
          preset: presetLabel(dl, current.preset),
          version: current.version,
          author: authorLabel(dl, current.author) ?? '',
        })
    : project?.root_path ?? '';

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

  return {
    t, tx, dl,
    projectId,
    projectName: project?.name ?? null,
    snapshot: current,
    loading, error, refetch,
    subtitle,
    lanes, order,
    evidence: current?.evidence ?? [],
    selected, select,
    openStepId, openStep, closeStep,
    headline: head.headline,
    headlineHealth: head.headlineHealth,
    headlineState: head.headlineState,
    missingText: missing.map((m) => `${stepLabel(dl, m.stepId, m.label)} (${bindingKindLabel(dl, m.kind)})`).join(', '),
    missingCount: missing.length,
    installing: forcePending || (current ? installInFlight(current) : false),
    install,
    installNote,
    askAthena,
  };
}
