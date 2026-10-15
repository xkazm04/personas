/** Mounts the real DeckModal on one lane, with the lanes join and the mandates in context (mandate-lanes WP5). */
import { vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { LaneCharter } from '@/lib/bindings/LaneCharter';
import type { LaneEntry } from '@/lib/bindings/LaneEntry';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { DecisionItem } from '../../model/decisionModel';
import type { LaneKey } from '../../lanes/laneModel';
import { DeckModal, type DeckSessionSpec } from '../DeckModal';
import type { DeckVerdict } from '../deckTypes';
import { DeckLaneContext } from '../shapes/DeckLaneContext';

export function mountLane(lane: LaneKey, items: DecisionItem[], entries: LaneEntry[], opts: { mandates?: MandateSummary[]; charters?: LaneCharter[] } = {}) {
  const onDecide = vi.fn((_v: DeckVerdict) => Promise.resolve());
  const lanes = new Map(entries.map((e) => [e.itemId, e]));
  const data = {
    lanes,
    mandates: new Map((opts.mandates ?? []).map((m) => [m.charterId, m])),
    charters: new Map((opts.charters ?? []).map((c) => [c.charterId, c])),
  };
  const spec: DeckSessionSpec = { key: 1, scope: { kind: 'lane', lane }, scopeLabel: lane, origin: null, readOnly: false };
  render(
    <AppKeyboardProvider>
      <DeckLaneContext.Provider value={data}>
        <DeckModal session={spec} items={items} loading={false} lanes={lanes} onDecide={onDecide} onBack={() => {}} onOpenLink={() => {}} />
      </DeckLaneContext.Provider>
    </AppKeyboardProvider>,
  );
  return { onDecide };
}

export const key = (k: string, code?: string) => fireEvent.keyDown(window, { key: k, code });
export const digit = (n: number) => key(String(n), `Digit${n}`);
