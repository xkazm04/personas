/**
 * The Sign lane's peek lists the draft mandates (mandate-lanes WP5P) and the
 * re-reads (polish: the peek never counts a card it cannot show):
 *  - a `mandate:<charterId>` the snapshot put in Sign is a row, although the
 *    roster carries no mandates, titled with what it asks and its project;
 *  - A and R on it open its Sign card (signing needs the envelope, a drop its
 *    reason) and never write through the roster; the row prints only Enter;
 *  - an active (non-draft) mandate is never a Sign row, unless its use asks a
 *    re-read: then it is one, titled with the reason, and A opens its card.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { DecisionLanesSnapshot } from '@/lib/bindings/DecisionLanesSnapshot';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';

import type { DecisionRoster } from '../../../useDecisionRoster';
import type { ChipCount, HubChip } from '../../../model/decisionModel';
import { useDecisionDeckStore } from '../../../deck/deckStore';
import { buildLaneCounts } from '../../../lanes/laneModel';
import { laneEntry, mandate } from '../../../mandate/__tests__/mandateFixtures';

const decide = vi.fn<DecisionRoster['decide']>(() => Promise.resolve());
let mandates: MandateSummary[] = [];

const snapshot: DecisionLanesSnapshot = {
  items: [
    laneEntry('mandate:c1', { lane: 'sign', clause: 'none', itemKind: 'mandate' }),
    laneEntry('mandate-reread:c3', { lane: 'sign', clause: 'none', itemKind: 'mandate', charterId: 'c3' }),
  ],
  charters: [{ charterId: 'c1', projectId: 'p1', status: 'draft', envelopeVersion: 0, held: 2 }],
  failedSources: [],
  generatedAt: '2026-10-15T09:00:00Z',
};

vi.mock('../../../lanes/useLanesSnapshot', () => ({
  useLanesSnapshot: () => ({ snapshot, failed: false, loading: false }),
  useCharterActRecorded: () => {},
  useDecisionSurface: () => 'lanes',
}));

vi.mock('@/features/fleet/monitor/grid/prototype/entry-e/mandate/useMandates', () => ({
  useMandates: (enabled: boolean) => ({ mandates: enabled ? mandates : null, failed: false, refresh: vi.fn() }),
}));

const chip = (n: number): ChipCount => ({ n, lamp: n > 0 ? 'warning' : 'neutral', failed: false });

vi.mock('../../../useDecisionRoster', () => ({
  useDecisionRoster: (): DecisionRoster => {
    const counts = Object.fromEntries(
      (['gates', 'proposals', 'backlog', 'incidents', 'council', 'reports', 'chat', 'ready'] as HubChip[]).map((c) => [c, chip(0)]),
    ) as Record<HubChip, ChipCount>;
    return {
      counts,
      total: 1,
      items: [],
      byChip: {},
      errors: {},
      loading: false,
      decide,
      refresh: vi.fn(),
      lanes: buildLaneCounts({ snapshot, snapshotFailed: false, questions: 0, chat: { n: 0, failed: false } }),
      laneTotal: 1,
      lanesSettled: true,
    } as unknown as DecisionRoster;
  },
}));

import { LaneHub } from '../LaneHub';

const originalScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
afterAll(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); });

function mount() {
  return render(
    <AppKeyboardProvider>
      <LaneHub />
    </AppKeyboardProvider>,
  );
}

beforeEach(() => {
  decide.mockClear();
  useDecisionDeckStore.setState({ request: null, session: 0, closedReturnTo: null });
  mandates = [
    mandate({ status: 'draft', envelope: { envelopeVersion: 0 } }),
    mandate({ charterId: 'c2', title: 'Already active' }),
    mandate({
      charterId: 'c3',
      title: 'Ship the docs',
      projectName: 'Docs',
      reread: { code: 'asks', asks: 9, acts: 4, spendPct: null, mergesSinceRead: 0, leadScope: null, leadAbsorbs: 0, keptAtActs: null, suggest: null },
    }),
  ];
});

describe('the Sign peek', () => {
  it('lists a draft mandate as a row with a readable title', async () => {
    mount();
    press('2');
    const row = await screen.findByTestId('decision-peek-row-mandate:c1');
    expect(row.textContent).toContain('Sign the Personas mandate: Keep Personas shipping');
    // The active mandate is a mandate, not a signature request.
    expect(screen.queryByTestId('decision-peek-row-mandate:c2')).toBeNull();
  });

  it('A opens the Sign card focused on the row and writes nothing', async () => {
    mount();
    press('2');
    const row = await screen.findByTestId('decision-peek-row-mandate:c1');
    fireEvent.mouseEnter(row);
    // Focused, the row prints only Enter: A and R open, they do not decide.
    expect(within(row).queryByText('R')).toBeNull();
    expect(within(row).getByText('↵')).toBeTruthy();
    press('a');
    expect(decide).not.toHaveBeenCalled();
    const request = useDecisionDeckStore.getState().request;
    expect(request?.focusId).toBe('mandate:c1');
    expect(request?.scope).toEqual({ kind: 'lane', lane: 'sign' });
  });

  it('R opens the card too, never arming a reject from the row', async () => {
    mount();
    press('2');
    fireEvent.mouseEnter(await screen.findByTestId('decision-peek-row-mandate:c1'));
    press('r');
    expect(screen.queryByTestId('decision-peek-armed')).toBeNull();
    expect(decide).not.toHaveBeenCalled();
    expect(useDecisionDeckStore.getState().request?.focusId).toBe('mandate:c1');
  });

  it('lists a re-read as a row titled with its reason, and A opens its card', async () => {
    mount();
    press('2');
    const row = await screen.findByTestId('decision-peek-row-mandate-reread:c3');
    expect(row.textContent).toContain('Docs');
    expect(screen.getAllByTestId(/^decision-peek-row-/)).toHaveLength(2);
    fireEvent.mouseEnter(row);
    press('a');
    expect(decide).not.toHaveBeenCalled();
    expect(useDecisionDeckStore.getState().request?.focusId).toBe('mandate-reread:c3');
  });
});
