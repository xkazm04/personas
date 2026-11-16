// @vitest-environment node
/**
 * The window's bp follower (lens/bpFollower.ts, spark roadmap S6 G4 and G5), driven by hand-cranked timers and a fake
 * FollowSource (no IPC, no bp):
 *  - presence: hello at once and every 15 s while a Blueprint surface is visible; hidden (the tab, or the window), the
 *    hellos stop and nothing is said, so bp lets Personas go 45 s after the last hello; the last surface closing says
 *    forget after a 1 s grace, and a surface that reopens within it (a product switch) keeps the presence;
 *  - following: reads once a second only while Follow is on AND a surface is visible; bp coming back hears follow again;
 *  - routing: the open sheet's product applies a place in place; another Personas product opens the sheet at the
 *    place; a slug with no Personas project holds still and notes "product <slug>"; the slug table is bp's (by root),
 *    re-read when a slug is unknown.
 */
import { describe, expect, it, vi } from 'vitest';
import { BpFollower, FOLLOW_HELLO_MS, FOLLOW_READ_MS, FORGET_GRACE_MS } from '../bpFollower';
import type { FollowSource } from '../../blueprint/source';
import type { FocusPlace } from '../../blueprint/model/focus';

/** Timers that only move when the test says so. */
function clock() {
  let now = 0, seq = 0;
  const jobs = new Map<number, { at: number; every?: number; fn: () => void }>();
  const add = (fn: () => void, ms: number, every?: number) => { seq += 1; const id = seq; jobs.set(id, { at: now + ms, ...(every !== undefined ? { every } : {}), fn }); return id; };
  return {
    now: () => now,
    setInterval: (fn: () => void, ms: number) => add(fn, ms, ms),
    clearInterval: (t: unknown) => { jobs.delete(t as number); },
    setTimeout: (fn: () => void, ms: number) => add(fn, ms),
    clearTimeout: (t: unknown) => { jobs.delete(t as number); },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, j] = due;
        now = j.at;
        if (j.every) j.at += j.every; else jobs.delete(id);
        j.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

const PRODUCTS = [
  { slug: 'kettle-web', name: 'Kettle Web', root: 'C:/demo/kettle-web', projectId: 'p-kettle' },
  { slug: 'pof', name: 'PoF', root: 'C:/demo/pof', projectId: 'p-pof' },
  { slug: 'atlas', name: 'Atlas', root: 'C:/demo/atlas' },
];
const room = (product: string, id: string): FocusPlace => ({ product, target: { kind: 'room', id }, level: 'L2' });
const view = (rev: number, place: FocusPlace, reader = 'web:1') => ({ rev, shared: { place, reader, surface: 'web', label: 'Web', at: '2026-10-31T07:00:00.000Z' }, readers: [] });

function setup(opts: { online?: () => boolean; view?: () => unknown } = {}) {
  const c = clock();
  const moves: string[] = [];
  let reads = 0, productReads = 0, windowShown = true;
  let onWin: (() => void) | null = null;
  const src: FollowSource = {
    reader: 'personas:main',
    read: async () => { reads++; const online = opts.online ? opts.online() : true; return online ? { online, view: opts.view ? opts.view() : { rev: 0, shared: null, readers: [] } } : { online, error: 'not running' }; },
    move: async (op) => { moves.push(op); return {}; },
    products: async () => { productReads++; return PRODUCTS; },
  };
  const open = vi.fn();
  const f = new BpFollower(src, {
    open, now: c.now, setInterval: c.setInterval, clearInterval: c.clearInterval, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout,
    windowVisible: () => windowShown, onWindowVisibility: (cb) => { onWin = cb; return () => { onWin = null; }; },
  });
  return {
    c, f, moves, open,
    reads: () => reads, productReads: () => productReads,
    hideWindow(hidden: boolean) { windowShown = !hidden; onWin?.(); },
  };
}
const count = (xs: string[], x: string) => xs.filter((y) => y === x).length;

describe('presence', () => {
  it('says hello at once and every 15 s while a surface is visible', async () => {
    const t = setup();
    t.f.surface(true);
    await t.c.advance(0);
    expect(t.moves).toEqual(['hello']);
    await t.c.advance(FOLLOW_HELLO_MS * 3);
    expect(count(t.moves, 'hello')).toBe(4);
    expect(t.f.getState().visible).toBe(1);
  });

  it('hidden (the tab or the window), stops saying hello and says nothing: bp lets it go 45 s later', async () => {
    const t = setup();
    const s = t.f.surface(true);
    await t.c.advance(FOLLOW_HELLO_MS);
    expect(count(t.moves, 'hello')).toBe(2);
    s.setVisible(false);
    await t.c.advance(60_000);
    expect(t.moves).toEqual(['hello', 'hello']);
    s.setVisible(true);
    expect(count(t.moves, 'hello')).toBe(3);
    t.hideWindow(true);
    expect(t.f.getState().visible).toBe(0);
    await t.c.advance(60_000);
    expect(count(t.moves, 'hello')).toBe(3);
    expect(t.moves).not.toContain('forget');
    t.hideWindow(false);
    expect(count(t.moves, 'hello')).toBe(4);
  });

  it('the last surface closing says forget after the grace; one that reopens within it keeps the presence', async () => {
    const t = setup();
    const a = t.f.surface(true);
    a.close();
    await t.c.advance(FORGET_GRACE_MS / 2);
    const b = t.f.surface(true); // the sheet remounting on another product
    await t.c.advance(FORGET_GRACE_MS * 2);
    expect(t.moves).not.toContain('forget');
    b.close();
    await t.c.advance(FORGET_GRACE_MS);
    expect(t.moves.at(-1)).toBe('forget');
    expect(t.moves).not.toContain('publish');
  });
});

describe('following', () => {
  it('reads once a second only while Follow is on and a surface is visible', async () => {
    const t = setup();
    const s = t.f.surface(true);
    await t.c.advance(5_000);
    expect(t.reads()).toBe(0);
    t.f.setOn(true);
    expect(t.moves).toContain('follow');
    await t.c.advance(FOLLOW_READ_MS * 4);
    expect(t.reads()).toBe(5); // at once, then every second
    s.setVisible(false);
    await t.c.advance(10_000);
    expect(t.reads()).toBe(5);
    t.f.setOn(false);
    expect(t.moves.at(-1)).toBe('unfollow');
  });

  it('says offline while bp is down and follow again when it comes back', async () => {
    let up = false;
    const t = setup({ online: () => up });
    t.f.surface(true);
    t.f.setOn(true);
    await t.c.advance(2_000);
    expect(t.f.getState().online).toBe(false);
    expect(count(t.moves, 'follow')).toBe(1);
    up = true;
    await t.c.advance(FOLLOW_READ_MS);
    expect(t.f.getState().online).toBe(true);
    expect(count(t.moves, 'follow')).toBe(2);
  });
});

describe('routing a shared place', () => {
  it('the open sheet\'s product applies it in place; never its own write, never a rev twice', async () => {
    let v: unknown = view(3, room('kettle-web', 'booking.core'));
    const t = setup({ view: () => v });
    t.f.surface(true);
    const apply = vi.fn(() => null);
    t.f.attach('p-kettle', apply);
    t.f.setOn(true);
    await t.c.advance(3_000);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(room('kettle-web', 'booking.core'));
    expect(t.f.getState()).toMatchObject({ rev: 3, from: 'Web', note: null });
    v = view(4, room('kettle-web', 'ops'), 'personas:main');
    await t.c.advance(2_000);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(t.open).not.toHaveBeenCalled();
  });

  it('a place the sheet cannot draw keeps its note', async () => {
    const t = setup({ view: () => view(5, room('kettle-web', 'nope')) });
    t.f.surface(true);
    t.f.attach('p-kettle', () => ({ kind: 'missing', what: 'room', id: 'nope' }));
    t.f.setOn(true);
    await t.c.advance(0);
    expect(t.f.getState().note).toEqual({ kind: 'missing', what: 'room', id: 'nope' });
  });

  it('another Personas product opens the sheet at the place', async () => {
    const t = setup({ view: () => view(6, room('pof', 'combat')) });
    t.f.surface(true);
    t.f.attach('p-kettle', () => null);
    t.f.setOn(true);
    await t.c.advance(0);
    expect(t.open).toHaveBeenCalledWith('p-pof', room('pof', 'combat'));
  });

  it('a product Personas has not got holds still and says so; an unknown slug re-reads bp\'s table', async () => {
    const t = setup({ view: () => view(7, room('atlas', 'maps')) });
    t.f.surface(true);
    t.f.setOn(true);
    await t.c.advance(0);
    expect(t.open).not.toHaveBeenCalled();
    expect(t.f.getState().note).toEqual({ kind: 'product', slug: 'atlas' });
    expect(await t.f.projectOf('kettle-web')).toBe('p-kettle');
    expect(await t.f.projectOf('ghost')).toBeUndefined();
    const before = t.productReads();
    await t.c.advance(11_000);
    expect(await t.f.projectOf('ghost')).toBeUndefined();
    expect(t.productReads()).toBe(before + 1);
  });
});
