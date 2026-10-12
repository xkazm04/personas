// Incidents are a history view: an incident still waiting on a person opens
// the Decision Deck (incidents chip, this one on top); a resolved or dismissed
// one keeps its detail modal.
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeDecisionDeck, useDecisionDeckStore } from '@/features/decision-center/deck/deckStore';
import { incidentRow } from '@/features/decision-center/__tests__/rosterFixtures';

import { openIncidentDoor } from '../incidentDeckDoor';

afterEach(() => act(() => closeDecisionDeck()));

describe('openIncidentDoor', () => {
  it.each(['open', 'acknowledged', 'in_progress'])('a %s incident opens the deck on its chip', (status) => {
    const showDetail = vi.fn();
    expect(openIncidentDoor(incidentRow({ id: 'inc-7', status }), showDetail)).toBe('deck');
    expect(showDetail).not.toHaveBeenCalled();
    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope).toEqual({ kind: 'chip', chip: 'incidents' });
    expect(req?.focusId).toBe('incident:inc-7');
  });

  it('grows out of the ledger row when it is on screen', () => {
    const row = document.createElement('div');
    row.id = 'incident-row-inc-8';
    row.getBoundingClientRect = () => ({ x: 1, y: 2, width: 3, height: 4 }) as DOMRect;
    document.body.appendChild(row);
    openIncidentDoor(incidentRow({ id: 'inc-8' }), vi.fn());
    expect(useDecisionDeckStore.getState().request?.origin).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    row.remove();
  });

  it.each(['resolved', 'dismissed'])('a %s incident keeps its detail modal', (status) => {
    const showDetail = vi.fn();
    const incident = incidentRow({ status });
    expect(openIncidentDoor(incident, showDetail)).toBe('detail');
    expect(showDetail).toHaveBeenCalledWith(incident);
    expect(useDecisionDeckStore.getState().request).toBeNull();
  });
});
