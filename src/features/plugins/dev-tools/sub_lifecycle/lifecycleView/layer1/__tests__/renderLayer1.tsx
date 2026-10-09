// Mounts a Lifecycle view on a real view model built from a fixture snapshot:
// the real lanes (`buildLanes`), a live selection, a live open step (Layer 2)
// and `openStep` as a spy. Used by the Layer-1 and the Layer-2 / preset tests.
import { useState, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { buildLanes } from '../../../journey/journeyModel';
import { LifecycleViewProvider } from '../../context';
import type { LifecycleViewModel } from '../../useLifecycleView';

export function renderLayer1(ui: ReactNode, snapshot: LifecycleSnapshot, initialOpen: string | null = null) {
  const openStep = vi.fn();
  function Harness() {
    const { t, tx } = useTranslation();
    const [selectedId, setSelectedId] = useState<string | null>(initialOpen);
    const [openStepId, setOpenStepId] = useState<string | null>(initialOpen);
    const lanes = buildLanes(snapshot);
    const order = [...lanes.before, ...lanes.after];
    const model: LifecycleViewModel = {
      t, tx, dl: t.plugins.dev_lifecycle,
      projectId: snapshot.projectId, projectName: 'Acme', snapshot,
      loading: false, error: null, refetch: () => {}, practice: null, freshness: null,
      lanes, order, evidence: snapshot.evidence,
      selected: order.find((n) => n.id === selectedId) ?? order[0] ?? null,
      select: setSelectedId,
      openStepId,
      openStep: (id: string) => { setSelectedId(id); setOpenStepId(id); openStep(id); },
      closeStep: () => setOpenStepId(null),
      stepFocus: null, clearStepFocus: () => {},
      headline: '', headlineHealth: null, headlineState: null, missingText: '', missingCount: 0,
      installing: false, install: async () => {}, installNote: null, askAthena: () => {},
    };
    return <LifecycleViewProvider model={model}>{ui}</LifecycleViewProvider>;
  }
  return { openStep, ...render(<Harness />) };
}
