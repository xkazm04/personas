/**
 * The Lifecycle surface's whole data model: one snapshot, the derived lanes,
 * the selected step, and the install / Ask-Athena actions. Extracted from
 * `LifecyclePage` so a LAYOUT is a file that arranges blocks rather than a
 * file that fetches, derives and renders at once.
 *
 * The selection lives here (not in the view) because every variant needs it
 * and because it is pre-seeded to the WEAKEST step: the inline state region
 * under the timeline then has content on first paint, so selecting a node
 * changes what the region says instead of making the region appear and shove
 * the timeline (docs/design/overview-loading.md, law 6).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { installLifecycle } from '@/api/devTools/lifecycle';
import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { authorLabel, bindingKindLabel, bindingStatePhrase, presetLabel, stepLabel } from '../journey/journeyLabels';
import { buildLanes, installInFlight, missingBindings, weakest } from '../journey/journeyModel';
import type { JourneyLanes, JourneyNode } from '../journey/journeyModel';
import { useLifecycleSnapshot } from '../journey/useLifecycleSnapshot';

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
  /** The step the state region is describing. Null only while there are no steps. */
  selected: JourneyNode | null;
  select: (stepId: string) => void;
  /** The weakest-step sentence, or the no-evidence / all-strong line. */
  headline: string;
  missingText: string;
  missingCount: number;
  installing: boolean;
  install: () => Promise<void>;
  askAthena: () => void;
}

export function useLifecycleView(): LifecycleViewModel {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const projectId = useSystemStore((s) => s.activeProjectId);
  const project = useSystemStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const addToast = useToastStore((s) => s.addToast);
  const ask = useAskAthena();
  const { snapshot, loading, error, refetch } = useLifecycleSnapshot(projectId);

  // The install task this surface just dispatched: missing bindings read as
  // pending until the refetched snapshot names that task.
  const [dispatched, setDispatched] = useState<{ projectId: string; taskId: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (dispatched && snapshot?.projectId === dispatched.projectId && snapshot.installTaskId === dispatched.taskId) {
      setDispatched(null);
    }
  }, [dispatched, snapshot]);

  const current = snapshot && snapshot.projectId === projectId ? snapshot : null;
  const forcePending = !!dispatched && dispatched.projectId === projectId;
  const lanes = useMemo(() => (current ? buildLanes(current, forcePending) : EMPTY_LANES), [current, forcePending]);
  const order = useMemo(() => [...lanes.before, ...lanes.after], [lanes]);
  const weak = useMemo(() => (current ? weakest(current) : null), [current]);
  const missing = useMemo(() => (current ? missingBindings(current) : []), [current]);

  // A project switch clears the selection; the fallback below re-seeds it.
  useEffect(() => { setSelectedId(null); }, [projectId]);

  const selected = useMemo(() => {
    if (order.length === 0) return null;
    const hit = selectedId ? order.find((n) => n.id === selectedId) : undefined;
    return hit ?? order.find((n) => n.id === weak?.node.id) ?? order[0] ?? null;
  }, [order, selectedId, weak]);

  const select = useCallback((stepId: string) => setSelectedId(stepId), []);

  const subtitle = current
    ? current.version === 0
      ? tx(dl.lc_subtitle_default, { preset: presetLabel(dl, current.preset) })
      : tx(dl.lc_subtitle_version, {
          preset: presetLabel(dl, current.preset),
          version: current.version,
          author: authorLabel(dl, current.author) ?? '',
        })
    : project?.root_path ?? '';

  const weakSentence = weak
    ? tx(weak.skipped > 0 ? dl.lc_weakest_with_skips : dl.lc_weakest_plain, {
        step: stepLabel(dl, weak.node.id, weak.node.label),
        state: bindingStatePhrase(dl, weak.node.strongestState),
        skipped: weak.skipped,
        total: weak.total,
      })
    : null;
  const headline = !current || current.evidence.length === 0
    ? [dl.lc_no_evidence, weakSentence].filter(Boolean).join(' ')
    : weakSentence ?? dl.lc_all_strong;

  const installRef = useRef(refetch);
  installRef.current = refetch;

  const install = useCallback(async () => {
    if (!projectId) return;
    try {
      const taskId = await installLifecycle(projectId);
      if (taskId) {
        setDispatched({ projectId, taskId });
        addToast(tx(dl.lc_install_started, { id: taskId }), 'success');
      } else {
        addToast(dl.lc_install_nothing, 'warning');
      }
      installRef.current();
    } catch (err) {
      toastCatch('lifecycle:install', dl.lc_install_failed)(err);
    }
  }, [projectId, addToast, tx, dl]);

  const askAthena = useCallback(() => {
    if (!project) return;
    const text = weak
      ? tx(dl.lc_ask_athena_prompt_weakest, {
          name: project.name, id: project.id, step: stepLabel(dl, weak.node.id, weak.node.label),
        })
      : tx(dl.lc_ask_athena_prompt, { name: project.name, id: project.id });
    ask('lifecycle', text);
  }, [project, weak, tx, dl, ask]);

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
    headline,
    missingText: missing.map((m) => `${stepLabel(dl, m.stepId, m.label)} (${bindingKindLabel(dl, m.kind)})`).join(', '),
    missingCount: missing.length,
    installing: forcePending || (current ? installInFlight(current) : false),
    install,
    askAthena,
  };
}
