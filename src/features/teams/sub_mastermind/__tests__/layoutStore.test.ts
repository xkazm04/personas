import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { invoke } from '@tauri-apps/api/core';
import { renderHook, act } from '@testing-library/react';
import { resetInvokeMocks } from '@/test/tauriMock';

import {
  athenaPanelsSnapshot,
  hydrateLayout,
  loadAthenaPanels,
  removeAthenaPanel,
  saveAthenaPanel,
  subscribeLayout,
  LAYOUT_KEY,
  WRITE_DEBOUNCE_MS,
  __resetLayoutStoreForTests,
  type AthenaPanel,
} from '../lib/layoutStore';
import { useAthenaPanels } from '../lib/useLayout';

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

const panel = (tag: string): AthenaPanel => ({ specVersion: 1, spec: { tag }, composedAt: '2026-09-25T00:00:00Z' });

describe('layoutStore — Athena panels', () => {
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

  it('hydrates panels from an existing DB document', async () => {
    dbValue = JSON.stringify({ version: 2, athenaPanels: { a: panel('a') } });
    await hydrateLayout();
    expect(loadAthenaPanels()).toEqual({ a: panel('a') });
  });

  it('drops panels on an unrecognised specVersion, keeps supported ones', async () => {
    dbValue = JSON.stringify({
      version: 2,
      athenaPanels: {
        good: panel('good'),
        future: { specVersion: 99, spec: {}, composedAt: 'x' },
        junk: { spec: {} },
        alsoJunk: 'nope',
      },
    });
    await hydrateLayout();
    expect(Object.keys(loadAthenaPanels())).toEqual(['good']);
    // …and the writer refuses an unsupported version too.
    saveAthenaPanel('later', { specVersion: 99, spec: {}, composedAt: 'x' });
    expect(Object.keys(loadAthenaPanels())).toEqual(['good']);
  });

  it('empty or corrupted DB → no panels, no write, never throws', async () => {
    dbValue = '{ not valid json';
    await expect(hydrateLayout()).resolves.toBeUndefined();
    expect(loadAthenaPanels()).toEqual({});
    expect(writes).toHaveLength(0);
  });

  it('carries the retired canvas fields through a write instead of erasing them', async () => {
    vi.useFakeTimers();
    const board = {
      positions: { a: { x: 1, y: 2 } },
      groups: [{ id: 'g', label: 'G', x: 0, y: 0, w: 1, h: 1, author: 'user' }],
      notes: [{ id: 'n', x: 0, y: 0, text: 't', size: 'md', font: 'inter' }],
      hidden: ['zzz'],
    };
    dbValue = JSON.stringify({ version: 2, ...board, athenaPanels: {} });
    await hydrateLayout();
    saveAthenaPanel('a', panel('a'));
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!)).toEqual({ version: 2, ...board, athenaPanels: { a: panel('a') } });
    const setCall = mocked.mock.calls.find((c) => c[0] === 'set_app_setting');
    expect((setCall![1] as { key: string }).key).toBe(LAYOUT_KEY);
  });

  it('debounced write-through coalesces a burst; restart re-reads it', async () => {
    vi.useFakeTimers();
    await hydrateLayout();
    saveAthenaPanel('a', panel('a1'));
    saveAthenaPanel('b', panel('b'));
    saveAthenaPanel('a', panel('a2')); // last write wins
    removeAthenaPanel('b');
    expect(writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS);
    expect(writes).toHaveLength(1);

    // Simulated restart: fresh store, same DB row, re-mock (clears dedup).
    __resetLayoutStoreForTests();
    resetInvokeMocks();
    installIpc();
    await hydrateLayout();
    expect(loadAthenaPanels()).toEqual({ a: panel('a2') });
  });

  it('never downgrades a document written by a NEWER build', async () => {
    vi.useFakeTimers();
    dbValue = JSON.stringify({ version: 3, athenaPanels: {}, lanes: [{ id: 'lane-1' }] });
    await hydrateLayout();
    saveAthenaPanel('a', panel('a'));
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS);
    // Preserve-and-default: run on what this build understands, and leave the
    // newer build's payload untouched rather than re-saving it as v2.
    expect(writes).toHaveLength(0);
    expect(JSON.parse(dbValue!)).toMatchObject({ version: 3, lanes: [{ id: 'lane-1' }] });
  });

  it('IPC unavailable → hydrate + writes fall back to localStorage, no crash', async () => {
    vi.useFakeTimers();
    failIpc = true;
    await expect(hydrateLayout()).resolves.toBeUndefined();
    saveAthenaPanel('q', panel('q'));
    await vi.advanceTimersByTimeAsync(WRITE_DEBOUNCE_MS);
    expect(writes).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(LAYOUT_KEY)!).athenaPanels).toEqual({ q: panel('q') });
  });

  it('an out-of-band write notifies subscribers and repaints a React reader', async () => {
    await hydrateLayout();
    const seen: number[] = [];
    const stop = subscribeLayout(() => seen.push(Object.keys(athenaPanelsSnapshot()).length));
    const before = athenaPanelsSnapshot();
    expect(athenaPanelsSnapshot()).toBe(before); // stable until someone writes
    const { result } = renderHook(() => useAthenaPanels());
    act(() => { saveAthenaPanel('hers', panel('hers')); });
    expect(seen).toEqual([1]);
    expect(athenaPanelsSnapshot()).not.toBe(before);
    expect(Object.keys(result.current)).toEqual(['hers']);
    stop();
  });
});
