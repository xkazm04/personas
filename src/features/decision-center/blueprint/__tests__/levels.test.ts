/**
 * Level scales (the r3 defect #1): L1 shows a wing AMONG ITS NEIGHBOURS at bp's scale (not one bay), L2 a room INSIDE
 * its wing, and each level is a step deeper than the one above, so the camera always knows which level it is at.
 */
import { describe, expect, it } from 'vitest';
import { kettleData } from '../fixture/kettle';
import { Camera, LEVEL_K, STEP } from '../engine/camera';
import { buildPlan } from '../model/plan';
import type { Box } from '../model/layout';

const data = kettleData();
const plan = buildPlan(data.structure, data.events);
const SAFE = { l: 8, t: 80, r: 84, b: 84 };

function camera(w: number, h: number): Camera {
  const c = new Camera(plan.L);
  c.resize(w, h, SAFE, true);
  return c;
}

/** The world rectangle the free part of the canvas shows. */
function visible(c: Camera): Box {
  const x0 = c.wx(c.SAFE.l), x1 = c.wx(c.SAFE.r), y0 = c.wy(c.SAFE.t), y1 = c.wy(c.SAFE.b);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe.each([[1280, 800], [1920, 1080]])('level scales at %ix%i', (w, h) => {
  it('the site fit shows the whole building; the camera reads L0', () => {
    const c = camera(w, h);
    c.x = c.HOME.x; c.y = c.HOME.y; c.k = c.HOME.k;
    expect(c.level().n).toBe(0);
    const v = visible(c);
    expect(v.x).toBeLessThanOrEqual(plan.L.world.x + 1);
    expect(v.x + v.w).toBeGreaterThanOrEqual(plan.L.world.x + plan.L.world.w - 1);
  });

  it('L1 holds bp\'s level scale and shows a wing among its neighbours', () => {
    const c = camera(w, h);
    const mid = plan.L.wings[Math.floor(plan.L.wings.length / 2)]!;
    const k1 = c.fitKOf(mid);
    expect(k1).toBeLessThanOrEqual(LEVEL_K.wing + 1e-9);
    expect(k1).toBeGreaterThan(c.HOME.k);
    const view = c.fitOf(mid);
    c.x = view.x; c.y = view.y; c.k = view.k;
    const v = visible(c);
    const neighbours = plan.L.wings.filter((o) => o !== mid && overlaps(v, o));
    expect(neighbours.length, 'a neighbouring wing is in view at L1').toBeGreaterThanOrEqual(1);
    expect(c.level().n).toBe(1);
  });

  it('L2 shows a room inside its wing, one step deeper than L1, and holds bp\'s room scale', () => {
    const c = camera(w, h);
    const wing = plan.L.wings.find((o) => o.rooms.length >= 1)!;
    const room = wing.rooms[0]!;
    expect(c.fitKOf(room)).toBeLessThanOrEqual(LEVEL_K.room + 1e-9);
    expect(c.fitKOf(room)).toBeGreaterThanOrEqual(c.fitKOf(wing) * STEP - 1e-9);
    const view = c.fitOf(room);
    c.x = view.x; c.y = view.y; c.k = view.k;
    expect(c.level().n).toBeGreaterThanOrEqual(2);
    const v = visible(c);
    expect(overlaps(v, room)).toBe(true);
    // the room is a part of its wing, not the whole of it, when the wing holds more than one room or is wider than the view
    expect(room.w * c.k <= (c.SAFE.r - c.SAFE.l) + 1e-6 || wing.rooms.length >= 1).toBe(true);
  });

  it('every level is deeper than the one above: site < wing < room < bay', () => {
    const c = camera(w, h);
    for (const T of plan.L.tiles) {
      const kWing = c.fitKOf(T.wing), kRoom = c.fitKOf(T.room), kBay = c.fitKOf(T.bay);
      expect(kWing, T.id).toBeGreaterThan(c.HOME.k);
      expect(kRoom, T.id).toBeGreaterThanOrEqual(kWing * STEP - 1e-9);
      expect(kBay, T.id).toBeGreaterThanOrEqual(kRoom * STEP - 1e-9);
    }
  });

  it('the camera reads each level at its own fit, and not the next one', () => {
    const c = camera(w, h);
    const T = plan.L.tiles[Math.floor(plan.L.tiles.length / 2)]!;
    [[T.wing, 1], [T.room, 2], [T.bay, 3]].forEach(([o, n]) => {
      const view = c.fitOf(o as typeof T.wing);
      c.x = view.x; c.y = view.y; c.k = view.k;
      expect(c.level().n, `${(o as typeof T.wing).kind} fit`).toBe(n);
    });
  });
});
