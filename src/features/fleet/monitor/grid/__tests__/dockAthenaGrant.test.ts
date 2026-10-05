// dockAthenaGrant — the grant must land on what the dispatch became, and the
// operator must hear about it when it does not.
//
// The failure these tests exist for: a dispatch that RAN while the operator
// believes Athena owns it. Every path that could produce that silently is
// asserted to produce a `problem` instead.

import { describe, expect, it, vi } from 'vitest';
import { grantAthenaToDispatch } from '../dockAthenaGrant';
import type { FleetSession } from '@/lib/bindings/FleetSession';

const session = (id: string, cwd: string, state = 'running'): FleetSession =>
  ({ id, cwd, state } as unknown as FleetSession);

/** No real waiting: the watch loop's clock is injected. */
const nosleep = () => Promise.resolve();

describe('grantAthenaToDispatch', () => {
  it('flags the session that appeared for this dispatch, and nothing else', async () => {
    const flag = vi.fn(async () => true);
    const out = await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set(['old']),
      sessions: () => [
        session('old', 'C:/repo/one'),
        session('new', 'C:/repo/one'),
        session('elsewhere', 'C:/repo/two'),
      ],
      flag,
      sleep: nosleep,
    });
    expect(out).toEqual({ granted: ['new'], problem: 'none' });
    expect(flag).toHaveBeenCalledTimes(1);
    expect(flag).toHaveBeenCalledWith('new', true);
  });

  it('matches the project root through the same normalisation the board groups by', async () => {
    const flag = vi.fn(async () => true);
    // Backslashes, a trailing separator and a different case: one repo.
    const out = await grantAthenaToDispatch({
      cwd: 'C:\\Repo\\One\\',
      before: new Set<string>(),
      sessions: () => [session('new', 'c:/repo/one')],
      flag,
      sleep: nosleep,
    });
    expect(out.granted).toEqual(['new']);
  });

  it('lands on a QUEUED row, because the door inserts it before anything starts', async () => {
    const flag = vi.fn(async () => true);
    const out = await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set<string>(),
      sessions: () => [session('waiting', 'C:/repo/one', 'queued')],
      flag,
      sleep: nosleep,
    });
    expect(out).toEqual({ granted: ['waiting'], problem: 'none' });
  });

  it('waits for the session to appear rather than giving up on the first look', async () => {
    const flag = vi.fn(async () => true);
    let ticks = 0;
    const out = await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set<string>(),
      sessions: () => (ticks >= 3 ? [session('late', 'C:/repo/one')] : []),
      flag,
      sleep: async () => { ticks += 1; },
    });
    expect(out.granted).toEqual(['late']);
    expect(ticks).toBe(3);
  });

  it('reports `unseen` when no session ever appears — never a silent success', async () => {
    const flag = vi.fn(async () => true);
    const out = await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set(['old']),
      sessions: () => [session('old', 'C:/repo/one')],
      flag,
      waitMs: 0,
      sleep: nosleep,
    });
    expect(out).toEqual({ granted: [], problem: 'unseen' });
    expect(flag).not.toHaveBeenCalled();
  });

  it('reports `refused` when the write throws', async () => {
    const out = await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set<string>(),
      sessions: () => [session('new', 'C:/repo/one')],
      flag: async () => { throw new Error('door closed'); },
      sleep: nosleep,
    });
    expect(out).toEqual({ granted: [], problem: 'refused' });
  });

  it('reports `refused` when the write resolves FALSE — the grant did not take', async () => {
    const out = await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set<string>(),
      sessions: () => [session('new', 'C:/repo/one')],
      flag: async () => false,
      sleep: nosleep,
    });
    expect(out).toEqual({ granted: [], problem: 'refused' });
  });

  it('keeps a succeeding write when a sibling write fails, and still reports the failure', async () => {
    const out = await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set<string>(),
      sessions: () => [session('a', 'C:/repo/one'), session('b', 'C:/repo/one')],
      flag: async (id) => { if (id === 'b') throw new Error('nope'); return true; },
      sleep: nosleep,
    });
    expect(out).toEqual({ granted: ['a'], problem: 'refused' });
  });

  it('never revokes: the only value it ever writes is true', async () => {
    const flag = vi.fn(async (_id: string, _on: boolean) => true);
    await grantAthenaToDispatch({
      cwd: 'C:/repo/one',
      before: new Set<string>(),
      sessions: () => [session('new', 'C:/repo/one')],
      flag,
      sleep: nosleep,
    });
    expect(flag.mock.calls.every(([, on]) => on === true)).toBe(true);
  });
});
