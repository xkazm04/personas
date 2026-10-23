// The engine's view, for React. The canvas draws at frame rate; the chrome reads two small snapshots through
// useSyncExternalStore: the LEVEL (which place the camera is over and how deep: changes a few times a minute) and
// the SCALE (the zoom readout and the names budget: changes while the wheel turns). Each snapshot is replaced only
// when a field changed, so a component that reads the level never re-renders for a zoom tick (the sidebar defect the
// prototype fixed: the queue showed L3 while the plan showed L0).
import { useSyncExternalStore } from 'react';
import type { Engine } from '../engine/Engine';
import type { ChainIds, Level } from '../model/scope';

export interface LevelSnap extends ChainIds { n: Level; lodHigh: boolean }
export interface ScaleSnap { den: number; names: number; tiles: number }

const INITIAL_LEVEL: LevelSnap = { n: 0, lodHigh: false };
const INITIAL_SCALE: ScaleSnap = { den: 0, names: 0, tiles: 0 };

export class ViewStore {
  level: LevelSnap = INITIAL_LEVEL;
  scale: ScaleSnap = INITIAL_SCALE;
  private subs = new Set<() => void>();
  private frames = new Set<(e: Engine) => void>();

  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  /** Called after EVERY drawn frame, outside React: for small canvases that follow the camera (the key plan). */
  onFrame = (fn: (e: Engine) => void): (() => void) => { this.frames.add(fn); return () => { this.frames.delete(fn); }; };
  getLevel = (): LevelSnap => this.level;
  getScale = (): ScaleSnap => this.scale;

  /** Read the engine; notify only when something changed. */
  sync(e: Engine): void {
    for (const fn of this.frames) fn(e);
    const { n, chain } = e.cam.level();
    const lvl: LevelSnap = { n: n as Level, wing: chain[0]?.id, room: chain[1]?.id, bay: chain[2]?.id, lodHigh: e.cam.lod() > 0.5 };
    const sc: ScaleSnap = { den: Math.round(100 / e.cam.k), names: e.budget.names, tiles: e.budget.of };
    let changed = false;
    const o = this.level;
    if (o.n !== lvl.n || o.wing !== lvl.wing || o.room !== lvl.room || o.bay !== lvl.bay || o.lodHigh !== lvl.lodHigh) { this.level = lvl; changed = true; }
    const s = this.scale;
    if (s.den !== sc.den || s.names !== sc.names || s.tiles !== sc.tiles) { this.scale = sc; changed = true; }
    if (changed) for (const fn of this.subs) fn();
  }
}

export const useViewLevel = (v: ViewStore): LevelSnap => useSyncExternalStore(v.subscribe, v.getLevel);
export const useViewScale = (v: ViewStore): ScaleSnap => useSyncExternalStore(v.subscribe, v.getScale);
