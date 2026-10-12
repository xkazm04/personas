/**
 * The bay's second door: "Open in Decision Center" hands the subject ON SCREEN
 * to the global deck as a `single` item built by the roster's own adapter, so
 * the deck decides through the same `decideCouncilRow` with the same digest.
 * The in-page gate stays; the fixture (no backend) gets no door.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeDecisionDeck, useDecisionDeckStore } from '@/features/decision-center/deck/deckStore';
import { councilDetail, councilSubject } from '@/features/decision-center/__tests__/rosterFixtures';

import { useCouncilStore } from '../councilStore';
import { CouncilGateBay } from '../gate/CouncilGateBay';
import { ARCHITECTURE_V1 } from '../table/rubrics';

afterEach(() => {
  act(() => closeDecisionDeck());
  useCouncilStore.setState({ fixtureOn: false });
});

describe('CouncilGateBay → Decision Deck', () => {
  it('opens a single council item carrying the on-screen digest, and keeps the gate', () => {
    useCouncilStore.setState({ fixtureOn: false });
    render(
      <CouncilGateBay
        subject={councilSubject()}
        detail={councilDetail()}
        rubric={ARCHITECTURE_V1}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByTestId('council-gate-approve')).toBeTruthy();
    fireEvent.click(screen.getByTestId('council-gate-open-deck'));
    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope.kind).toBe('single');
    if (req?.scope.kind !== 'single') throw new Error('unreachable');
    expect(req.scope.item.id).toBe('council:cs-1');
    expect(req.scope.item.kind).toBe('council');
    expect(req.scope.item.payload?.sawDigest).toBe('digest-2');
    expect(req.scope.item.payload?.runId).toBe('run-2');
    expect(req.scope.readOnly).toBeUndefined();
  });

  it('re-reads the round when the deck it opened closes', () => {
    const onReload = vi.fn();
    const refreshCouncils = vi.fn().mockResolvedValue(undefined);
    useCouncilStore.setState({ fixtureOn: false, refreshCouncils });
    render(
      <CouncilGateBay
        subject={councilSubject()}
        detail={councilDetail()}
        rubric={ARCHITECTURE_V1}
        onReload={onReload}
      />,
    );
    fireEvent.click(screen.getByTestId('council-gate-open-deck'));
    expect(onReload).not.toHaveBeenCalled();
    act(() => closeDecisionDeck());
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(refreshCouncils).toHaveBeenCalledTimes(1);
  });

  it('offers no deck door in fixture mode', () => {
    useCouncilStore.setState({ fixtureOn: true });
    render(
      <CouncilGateBay
        subject={councilSubject()}
        detail={councilDetail()}
        rubric={ARCHITECTURE_V1}
        onReload={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('council-gate-open-deck')).toBeNull();
  });
});
