import { describe, it, expect, beforeEach, vi } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { invoke } from '@tauri-apps/api/core';
import { renderHook, act } from '@testing-library/react';
import { resetInvokeMocks } from '@/test/tauriMock';

import {
  countAthenaObjects,
  hydrateLayout,
  loadAthenaPanels,
  loadGroups,
  loadLinks,
  loadNotes,
  revertAthenaObjects,
  saveAthenaPanel,
  saveGroups,
  saveLinks,
  saveNotes,
  subscribeLayout,
  groupsSnapshot,
  __resetLayoutStoreForTests,
} from '../lib/layoutStore';
import { useLayoutGroups, useAthenaObjectCount } from '../lib/useLayout';
import { canvasId } from '../lib/canvasIds';
import type { CanvasNote, GroupRect, UserLink } from '../lib/types';

const mocked = vi.mocked(invoke);
let dbValue: string | null = null;

function installIpc(): void {
  mocked.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === 'get_app_setting') return dbValue;
    if (cmd === 'set_app_setting') {
      dbValue = (args as { key: string; value: string }).value;
      return undefined;
    }
    return undefined;
  });
}

const group = (id: string, author?: 'user' | 'athena'): GroupRect =>
  ({ id, label: id, x: 0, y: 0, w: 10, h: 10, ...(author ? { author } : {}) });

beforeEach(() => {
  resetInvokeMocks();
  dbValue = null;
  installIpc();
  __resetLayoutStoreForTests();
  localStorage.clear();
});

describe('layout doc v1 → v2 migration', () => {
  it('attributes every pre-existing (v1) object to the user', async () => {
    dbValue = JSON.stringify({
      version: 1,
      positions: {},
      groups: [{ id: 'g', label: 'G', x: 0, y: 0, w: 1, h: 1 }],
      links: [{ id: 'l', from: 'a', to: 'b', label: '', dashed: false, color: 'var(--primary)' }],
      notes: [{ id: 'n', x: 0, y: 0, text: 't', size: 'md', font: 'inter' }],
      hidden: [],
    });
    await hydrateLayout();
    expect(loadGroups()[0]!.author).toBe('user');
    expect(loadLinks()[0]!.author).toBe('user');
    expect(loadNotes()[0]!.author).toBe('user');
    expect(countAthenaObjects()).toBe(0);
  });

  it('keeps an explicit athena attribution and coerces garbage to user', async () => {
    dbValue = JSON.stringify({
      version: 2,
      groups: [
        { id: 'a', label: 'A', x: 0, y: 0, w: 1, h: 1, author: 'athena' },
        { id: 'b', label: 'B', x: 0, y: 0, w: 1, h: 1, author: 'gremlin' },
        { id: 'c', label: 'C', x: 0, y: 0, w: 1, h: 1, author: 7 },
        'not an object',
      ],
    });
    await hydrateLayout();
    const groups = loadGroups();
    expect(groups.map((g) => [g.id, g.author])).toEqual([['a', 'athena'], ['b', 'user'], ['c', 'user']]);
  });

  it('legacy localStorage import still works and lands attributed to the user', async () => {
    localStorage.setItem('mastermind.groups.v1', JSON.stringify([{ id: 'lg', label: 'L', x: 0, y: 0, w: 2, h: 2 }]));
    await hydrateLayout();
    expect(loadGroups()).toEqual([{ id: 'lg', label: 'L', x: 0, y: 0, w: 2, h: 2, author: 'user' }]);
  });

  it('drops athenaPanels entries on an unrecognised specVersion, keeps supported ones', async () => {
    dbValue = JSON.stringify({
      version: 2,
      athenaPanels: {
        good: { specVersion: 1, spec: { any: 'shape' }, composedAt: '2026-08-04T00:00:00Z' },
        future: { specVersion: 99, spec: {}, composedAt: '2026-08-04T00:00:00Z' },
        junk: { spec: {} },
        alsoJunk: 'nope',
      },
    });
    await hydrateLayout();
    const panels = loadAthenaPanels();
    expect(Object.keys(panels)).toEqual(['good']);
    expect(panels.good!.spec).toEqual({ any: 'shape' });
    // …and the writer refuses an unsupported version too.
    saveAthenaPanel('later', { specVersion: 99, spec: {}, composedAt: 'x' });
    expect(Object.keys(loadAthenaPanels())).toEqual(['good']);
  });

  it('a corrupted doc is still empty and never throws', async () => {
    dbValue = '{ not valid json';
    await expect(hydrateLayout()).resolves.toBeUndefined();
    expect(loadGroups()).toEqual([]);
    expect(loadAthenaPanels()).toEqual({});
  });
});

describe('reactivity — two writers on one board', () => {
  it('notifies subscribers on an out-of-band write and invalidates the snapshot', async () => {
    await hydrateLayout();
    const seen: number[] = [];
    const stop = subscribeLayout(() => seen.push(groupsSnapshot().length));
    const before = groupsSnapshot();
    expect(groupsSnapshot()).toBe(before); // stable until someone writes

    saveGroups([group('athena-1', 'athena')]);

    expect(seen).toEqual([1]);
    expect(groupsSnapshot()).not.toBe(before);
    stop();
  });

  it('a later user commit does not clobber the out-of-band write', async () => {
    await hydrateLayout();
    saveGroups([group('mine', 'user')]);
    // Athena writes while the user is on the canvas.
    saveGroups([...loadGroups(), group('hers', 'athena')]);
    // The user's next commit is built from the CURRENT store, not a mount-time
    // snapshot — this is exactly what CanvasShell does now.
    saveGroups([...loadGroups(), group('mine-2', 'user')]);
    expect(loadGroups().map((g) => g.id)).toEqual(['mine', 'hers', 'mine-2']);
  });

  it('a React reader re-renders on an out-of-band write with no remount', async () => {
    await hydrateLayout();
    const { result } = renderHook(() => useLayoutGroups());
    expect(result.current).toHaveLength(0);
    act(() => { saveGroups([group('hers', 'athena')]); });
    expect(result.current.map((g) => g.id)).toEqual(['hers']);
    const { result: count } = renderHook(() => useAthenaObjectCount());
    expect(count.current).toBe(1);
    act(() => { revertAthenaObjects(); });
    expect(result.current).toHaveLength(0);
    expect(count.current).toBe(0);
  });
});

describe('revert removes only hers', () => {
  it('leaves every user-authored object untouched', async () => {
    await hydrateLayout();
    saveGroups([group('g-user', 'user'), group('g-athena', 'athena')]);
    const links: UserLink[] = [
      { id: 'l-user', from: 'a', to: 'b', label: '', dashed: false, color: 'var(--primary)', author: 'user' },
      { id: 'l-athena', from: 'a', to: 'c', label: '', dashed: false, color: 'var(--accent)', author: 'athena' },
    ];
    saveLinks(links);
    const notes: CanvasNote[] = [
      { id: 'n-legacy', x: 0, y: 0, text: 'pre-v2', size: 'md', font: 'inter' },
      { id: 'n-athena', x: 1, y: 1, text: 'hers', size: 'md', font: 'inter', author: 'athena' },
    ];
    saveNotes(notes);
    saveAthenaPanel('proj', { specVersion: 1, spec: { a: 1 }, composedAt: '2026-08-04T00:00:00Z' });

    // Annotations only — a composed panel is a different scope with its own
    // per-project reset, so it is neither counted nor removed here.
    expect(countAthenaObjects()).toBe(3);
    expect(revertAthenaObjects()).toBe(3);

    expect(loadGroups().map((g) => g.id)).toEqual(['g-user']);
    expect(loadLinks().map((l) => l.id)).toEqual(['l-user']);
    // An un-attributed (legacy) note is the user's and must survive.
    expect(loadNotes().map((n) => n.id)).toEqual(['n-legacy']);
    expect(revertAthenaObjects()).toBe(0);
  });

  it('leaves composed panels alone — reverting marks is not a panel reset', async () => {
    await hydrateLayout();
    saveGroups([group('hers', 'athena')]);
    saveAthenaPanel('proj', { specVersion: 1, spec: { a: 1 }, composedAt: '2026-08-04T00:00:00Z' });
    revertAthenaObjects();
    expect(loadGroups()).toEqual([]);
    expect(Object.keys(loadAthenaPanels())).toEqual(['proj']);
  });
});

describe('canvasId', () => {
  it('is unique across same-millisecond bursts from two writers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00Z'));
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(canvasId('g'));
    expect(ids.size).toBe(500);
    expect([...ids].every((id) => id.startsWith('g'))).toBe(true);
    vi.useRealTimers();
  });
});
