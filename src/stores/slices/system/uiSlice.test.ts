import { describe, it, expect } from 'vitest';

// storeBus is consulted by setSidebarSection (selected-persona lookup) and
// navigateBack (emit). Stub it so the slice runs without the full app bus.
import { vi } from 'vitest';
vi.mock('@/lib/storeBus', () => ({
  storeBus: { get: () => undefined, emit: () => {} },
  AccessorKey: { AGENTS_SELECTED_PERSONA_ID: 'agents.selectedPersonaId' },
}));

import { createUiSlice, type HeaderOverlay } from './uiSlice';
import type { SystemStore } from '../../storeTypes';

// Minimal Zustand-style harness (mirrors tourSlice.test.ts / networkSlice.test.ts).
function makeHarness(seed: Partial<SystemStore> = {}) {
  let state = {} as SystemStore;
  const set = (
    partial: Partial<SystemStore> | ((s: SystemStore) => Partial<SystemStore>),
  ) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: SystemStore) => Partial<SystemStore>)(state)
      : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  const slice = createUiSlice(set as never, get as never, {} as never);
  state = { ...state, ...slice, ...seed };
  return {
    get: () => state,
    overlay: () => state.headerOverlay as HeaderOverlay,
  };
}

describe('uiSlice — headerOverlay controller', () => {
  it('defaults to no overlay', () => {
    expect(makeHarness().overlay()).toBe('none');
  });

  it('setHeaderOverlay is mutually exclusive (one enum, never two open)', () => {
    const h = makeHarness();
    h.get().setHeaderOverlay('notifications');
    expect(h.overlay()).toBe('notifications');
    h.get().setHeaderOverlay('monitor'); // structurally replaces, never stacks
    expect(h.overlay()).toBe('monitor');
    h.get().setHeaderOverlay('none');
    expect(h.overlay()).toBe('none');
  });

  it('setMonitorOpen shim maps to the controller', () => {
    const h = makeHarness();
    h.get().setMonitorOpen(true);
    expect(h.overlay()).toBe('monitor');
    h.get().setMonitorOpen(false);
    expect(h.overlay()).toBe('none');
  });

  it('setMonitorOpen(false) does not clobber a Notifications overlay', () => {
    const h = makeHarness({ headerOverlay: 'notifications' });
    h.get().setMonitorOpen(false); // closing the Monitor shouldn't touch Notifications
    expect(h.overlay()).toBe('notifications');
  });

  it('navigating a route dismisses any open overlay', () => {
    const h = makeHarness({ sidebarSection: 'home', headerOverlay: 'monitor', navigationHistory: [] });
    h.get().setSidebarSection('schedules');
    expect(h.get().sidebarSection).toBe('schedules');
    expect(h.overlay()).toBe('none');
    expect(h.get().navigationHistory.length).toBe(1); // outgoing 'home' recorded
  });

  it('Back closes an open overlay FIRST and leaves section history intact', () => {
    const h = makeHarness({
      sidebarSection: 'schedules',
      headerOverlay: 'monitor',
      navigationHistory: [{ section: 'home', personaId: null }],
    });
    h.get().navigateBack();
    expect(h.overlay()).toBe('none');
    expect(h.get().sidebarSection).toBe('schedules');           // unchanged
    expect(h.get().navigationHistory.length).toBe(1);           // NOT popped
  });

  it('Back pops the section history when no overlay is open', () => {
    const h = makeHarness({
      sidebarSection: 'schedules',
      headerOverlay: 'none',
      navigationHistory: [{ section: 'home', personaId: null }],
    });
    h.get().navigateBack();
    expect(h.get().sidebarSection).toBe('home');
    expect(h.get().navigationHistory.length).toBe(0);
  });
});
