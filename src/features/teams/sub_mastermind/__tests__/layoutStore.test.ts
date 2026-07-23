import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { invoke } from '@tauri-apps/api/core';
import { resetInvokeMocks } from '@/test/tauriMock';

import {
  hydrateLayout,
  isLayoutHydrated,
  loadGroups,
  loadHidden,
  loadNotes,
  loadPositions,
  savePositions,
  saveGroups,
  saveNotes,
  LAYOUT_KEY,
  WRITE_DEBOUNCE_MS,
  __resetLayoutStoreForTests,
} from '../lib/layoutStore';

const mocked = vi.mocked(invoke);

// A tiny in-memory stand-in for the app_settings row behind `mastermind.layout.v1`,
// plus a log of every value written through `set_app_setting`.
let dbValue: string | null = null;
let writes: string[] = [];
let failIpc = false;

/** (Re)install the IPC mock over the shared db closure. Call after
 *  `resetInvokeMocks()` (which wipes the implementation). */
function installIpc(): void {
  mocked.mockImplementation(async (cmd: string, args?: unknown) => {
    if (failIpc) throw new Error('ipc unavailable');
    if (cmd === 'get_app_setting') return dbValue;
    if (cmd === 'set_app_setting') {
      const v = (args as { key: string; value: string }).value;
      writes.push(v);
      dbValue = v;
      return undefined;
    }
    return undefined;
  });
}

const LEGACY = {
  positions: 'mastermind.positions.v1',
  groups: 'mastermind.groups.v1',
  links: 'mastermind.links.v1',
  notes: 'mastermind.notes.v1',
  hidden: 'mastermind.hidden.v1',
};

describe('layoutStore — DB boundary', () => {
  beforeEach(() => {
    resetInvokeMocks();
    dbValue = null;
    writes = [];
    failIpc = false;
    installIpc();
    __resetLayoutStoreForTests();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the in-memory doc from an existing DB document', async () => {
    dbValue = JSON.stringify({
      version: 1,
      positions: { a: { x: 1, y: 2 } },
      groups: [{ id: 'g', label: 'G', x: 0, y: 0, w: 1, h: 1 }],
      links: [],
      notes: [{ id: 'n', x: 0, y: 0, text: 't', size: 'md', font: 'inter' }],
      hidden: ['zzz'],
    });
    expect(isLayoutHydrated()).toBe(false);
    await hydrateLayout();
    expect(isLayoutHydrated()).toBe(true);
    expect(loadPositions()).toEqual({ a: { x: 1, y: 2 } });
    expect(loadGroups()).toHaveLength(1);
    expect(loadNotes()).toHaveLength(1);
    expect(loadHidden()).toEqual(new Set(['zzz']));
  });

  it('empty DB + no legacy keys → empty layout, no migration write', async () => {
    await hydrateLayout();
    expect(loadPositions()).toEqual({});
    expect(loadGroups()).toEqual([]);
    expect(writes).toHaveLength(0);
  });

  it('corrupted DB document falls back to empty (never throws)', async () => {
    dbValue = '{ not valid json';
    await expect(hydrateLayout()).resolves.toBeUndefined();
    expect(loadPositions()).toEqual({});
    expect(loadGroups()).toEqual([]);
  });

  it('one-time migration imports legacy localStorage keys and writes them through', async () => {
    localStorage.setItem(LEGACY.positions, JSON.stringify({ old: { x: 9, y: 9 } }));
    localStorage.setItem(LEGACY.groups, JSON.stringify([{ id: 'lg', label: 'L', x: 0, y: 0, w: 2, h: 2 }]));
    localStorage.setItem(LEGACY.hidden, JSON.stringify(['hiddenslug']));

    await hydrateLayout();

    // Imported into memory…
    expect(loadPositions()).toEqual({ old: { x: 9, y: 9 } });
    expect(loadGroups()).toHaveLength(1);
    expect(loadHidden()).toEqual(new Set(['hiddenslug']));
    // …and persisted to the DB exactly once (DB is now the source of truth).
    expect(writes).toHaveLength(1);
    const persisted = JSON.parse(dbValue!);
    expect(persisted.positions).toEqual({ old: { x: 9, y: 9 } });
    // set_app_setting was called with our registered key.
    const setCall = mocked.mock.calls.find((c) => c[0] === 'set_app_setting');
    expect((setCall![1] as { key: string }).key).toBe(LAYOUT_KEY);
  });

  it('restart-proof round-trip: write → (simulated restart) → re-read returns it', async () => {
    vi.useFakeTimers();
    await hydrateLayout();
    savePositions({ p: { x: 7, y: 8 } });
    // Debounced — nothing written until the window elapses.
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS);
    expect(writes).toHaveLength(1);

    // Simulate an app restart: fresh store, same DB row, re-mock (clears dedup).
    __resetLayoutStoreForTests();
    resetInvokeMocks();
    installIpc();
    await hydrateLayout();
    expect(loadPositions()).toEqual({ p: { x: 7, y: 8 } });
  });

  it('debounced write-through coalesces a burst into a single IPC call', async () => {
    vi.useFakeTimers();
    await hydrateLayout();
    savePositions({ a: { x: 1, y: 1 } });
    saveGroups([{ id: 'g', label: 'G', x: 0, y: 0, w: 1, h: 1 }]);
    saveNotes([{ id: 'n', x: 0, y: 0, text: 't', size: 'sm', font: 'inter' }]);
    savePositions({ a: { x: 2, y: 2 } }); // last write wins
    expect(writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS);

    expect(writes).toHaveLength(1);
    const doc = JSON.parse(writes[0]);
    expect(doc.positions).toEqual({ a: { x: 2, y: 2 } });
    expect(doc.groups).toHaveLength(1);
    expect(doc.notes).toHaveLength(1);
  });

  it('IPC unavailable → hydrate + writes fall back to localStorage, no crash', async () => {
    vi.useFakeTimers();
    failIpc = true;
    await expect(hydrateLayout()).resolves.toBeUndefined();
    expect(isLayoutHydrated()).toBe(true);

    savePositions({ q: { x: 3, y: 4 } });
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS);

    // No DB write happened; the doc landed in the single localStorage key.
    expect(writes).toHaveLength(0);
    const local = JSON.parse(localStorage.getItem(LAYOUT_KEY)!);
    expect(local.positions).toEqual({ q: { x: 3, y: 4 } });
  });
});
