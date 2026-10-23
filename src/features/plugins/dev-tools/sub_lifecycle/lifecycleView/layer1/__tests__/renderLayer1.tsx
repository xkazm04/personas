// Mounts a Lifecycle view on a real view model built from a fixture snapshot:
// the real lanes (`buildLanes`), a live selection, a live open step (the
// Lens's last layer), `openStep` as a spy, under the page's time cursor. Used
// by the project-plane, step screen and preset tests.
import { useState, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { buildLanes } from '../../../journey/journeyModel';
import { LifecycleViewProvider } from '../../context';
import { TimeTravelProvider } from '../../history/timeTravel';
import type { LifecycleViewModel, StepFocus } from '../../useLifecycleView';

/** `timeCursor: false` leaves the page's time cursor out, so a test counting history reads sees only its own. */
export function renderLayer1(ui: ReactNode, snapshot: LifecycleSnapshot, initialOpen: string | null = null, { timeCursor = true } = {}) {
  const openStep = vi.fn();
  function Harness() {
    const { t, tx } = useTranslation();
    const [selectedId, setSelectedId] = useState<string | null>(initialOpen);
    const [openStepId, setOpenStepId] = useState<string | null>(initialOpen);
    const [stepFocus, setStepFocus] = useState<StepFocus | null>(null);
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
      openStep: (id: string, focus?: StepFocus) => { setSelectedId(id); setOpenStepId(id); setStepFocus(focus ?? null); if (focus) openStep(id, focus); else openStep(id); },
      closeStep: () => setOpenStepId(null),
      stepFocus, clearStepFocus: () => setStepFocus(null),
      headline: '', headlineHealth: null, headlineState: null, missingText: '', missingCount: 0,
      installing: false, install: async () => {}, installNote: null, askAthena: () => {},
    };
    return (
      <LifecycleViewProvider model={model}>
        {timeCursor ? <TimeTravelProvider projectId={snapshot.projectId} ready>{ui}</TimeTravelProvider> : ui}
      </LifecycleViewProvider>
    );
  }
  return { openStep, ...render(<Harness />) };
}
