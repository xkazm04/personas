import { describe, it, expect, beforeEach } from 'vitest';

import { loadPositions, savePositions, type PositionMap } from '../lib/positions';
import { loadGroups, saveGroups } from '../lib/groups';
import { loadLinks, saveLinks } from '../lib/links';
import { loadNotes, saveNotes } from '../lib/notes';
import { hexPoints, hash01, spiralPlace } from '../lib/hex';
import type { GroupRect, UserLink, CanvasNote } from '../lib/types';

describe('canvas persistence — localStorage round-trips', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('positions: save → load identity', () => {
    const p: PositionMap = { alpha: { x: 10, y: -20 }, beta: { x: 3.5, y: 4.5 } };
    savePositions(p);
    expect(loadPositions()).toEqual(p);
  });

  it('groups: save → load identity', () => {
    const g: GroupRect[] = [{ id: 'g1', label: 'Backend', x: 0, y: 0, w: 100, h: 80 }];
    saveGroups(g);
    expect(loadGroups()).toEqual(g);
  });

  it('links: save → load identity', () => {
    const l: UserLink[] = [{ id: 'l1', from: 'a', to: 'b', label: 'api', dashed: true, color: 'var(--primary)' }];
    saveLinks(l);
    expect(loadLinks()).toEqual(l);
  });

  it('notes: save → load identity', () => {
    const n: CanvasNote[] = [{ id: 'n1', x: 5, y: 6, text: 'hi', size: 'md', font: 'inter' }];
    saveNotes(n);
    expect(loadNotes()).toEqual(n);
  });

  it('empty by default', () => {
    expect(loadPositions()).toEqual({});
    expect(loadGroups()).toEqual([]);
    expect(loadLinks()).toEqual([]);
    expect(loadNotes()).toEqual([]);
  });

  it('corrupted JSON falls back to empty (never throws)', () => {
    localStorage.setItem('mastermind.positions.v1', '{not json');
    localStorage.setItem('mastermind.groups.v1', 'oops[');
    localStorage.setItem('mastermind.links.v1', '<<<');
    localStorage.setItem('mastermind.notes.v1', '}}}');
    expect(loadPositions()).toEqual({});
    expect(loadGroups()).toEqual([]);
    expect(loadLinks()).toEqual([]);
    expect(loadNotes()).toEqual([]);
  });
});

describe('hex geometry invariants', () => {
  it('hexPoints emits 6 vertices, each at radius r from the centre', () => {
    const cx = 50;
    const cy = -30;
    const r = 24;
    const pts = hexPoints(cx, cy, r).split(' ').map((s) => s.split(',').map(Number));
    expect(pts).toHaveLength(6);
    for (const [x, y] of pts) {
      expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r, 1);
    }
  });

  it('hexPoints flat vs pointy differ but keep the radius', () => {
    const pointy = hexPoints(0, 0, 10, false);
    const flat = hexPoints(0, 0, 10, true);
    expect(pointy).not.toEqual(flat);
    for (const [x, y] of flat.split(' ').map((s) => s.split(',').map(Number))) {
      expect(Math.hypot(x, y)).toBeCloseTo(10, 1);
    }
  });

  it('hash01 is deterministic and within [0, 1)', () => {
    expect(hash01('demo-desktop')).toBe(hash01('demo-desktop'));
    const h = hash01('some-slug');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
    expect(hash01('a')).not.toBe(hash01('b'));
  });

  it('spiralPlace pins island 0 at the origin', () => {
    expect(spiralPlace(0, 'anything')).toEqual({ x: 0, y: 0 });
  });

  it('spiralPlace is deterministic per (index, slug) and spreads outward', () => {
    expect(spiralPlace(3, 'proj')).toEqual(spiralPlace(3, 'proj'));
    // Same index, different slug → different jitter angle.
    expect(spiralPlace(3, 'proj')).not.toEqual(spiralPlace(3, 'other'));
    // Farther index sits farther from the origin.
    const near = spiralPlace(1, 'proj');
    const far = spiralPlace(9, 'proj');
    expect(Math.hypot(far.x, far.y)).toBeGreaterThan(Math.hypot(near.x, near.y));
  });
});
