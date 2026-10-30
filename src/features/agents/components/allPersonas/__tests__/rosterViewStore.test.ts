import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { sanitizeRosterView, useRosterViewStore } from '../rosterViewStore';
import { DEFAULT_VIEW_CONFIG } from '../viewConfig';

const KEY = 'persona-roster-view';

// Round 2 card 10: the roster's sort and filters lived in component state and
// reset to "Last run, newest" on every visit.
describe('rosterViewStore', () => {
  beforeEach(() => {
    act(() => useRosterViewStore.getState().resetView());
  });

  it('writes the view to durable storage when it changes', () => {
    act(() => useRosterViewStore.getState().setView((v) => ({ ...v, sortKey: 'spend', healthFilter: 'failing' })));
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as { state?: { view?: unknown } };
    expect(stored.state?.view).toMatchObject({ sortKey: 'spend', healthFilter: 'failing' });
  });

  it('restores a persisted view on rehydrate (the next visit or launch)', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      state: { view: { ...DEFAULT_VIEW_CONFIG, sortKey: 'name', sortDirection: 'asc', favoriteOnly: true } }, version: 0,
    }));
    await act(async () => { await useRosterViewStore.persist.rehydrate(); });
    expect(useRosterViewStore.getState().view).toMatchObject({ sortKey: 'name', sortDirection: 'asc', favoriteOnly: true });
  });

  it('drops values a later build no longer knows, field by field', () => {
    expect(sanitizeRosterView({ sortKey: 'retired', statusFilter: 'zombie', healthFilter: 'failing', sortDirection: 'sideways' }))
      .toEqual({ ...DEFAULT_VIEW_CONFIG, healthFilter: 'failing' });
    expect(sanitizeRosterView('junk')).toEqual(DEFAULT_VIEW_CONFIG);
  });
});
