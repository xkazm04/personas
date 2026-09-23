// Everything the bezel draws that MOVES, advanced on the engine's own curve:
// the glass opening (0 closed, 1 open), the four band thicknesses, and the
// dial's notch angles. Each follows the flight in progress - when a flight
// starts, it departs from the value drawn at that moment - so a mode switch
// or a descent that interrupts another never jumps.
import { useRef } from 'react';

import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout } from '../engine/types';
import { DialMotion, dialIndex, glassFor, mapAngles } from './bezelDial';
import type { BezelScene } from './bezelPaint';
import { focusNode, levelOf } from './fusedModel';

/** Bands inside out: techniques (4), subjects (3), categories (2), domains (1). */
const BAND_LEVEL = [4, 3, 2, 1];

class Follower {
  private value: number | null = null;

  private from = 0;

  private flight = -1;

  next(target: number, flightId: number, e: number, flying: boolean): number {
    if (this.value === null) {
      this.value = target;
      this.flight = flightId;
      return target;
    }
    if (flightId !== this.flight) {
      this.flight = flightId;
      this.from = this.value;
    }
    this.value = flying ? this.from + (target - this.from) * e : target;
    return this.value;
  }
}

export interface SceneState {
  open: Follower;
  thick: Follower[];
  dial: DialMotion;
}

export function useBezelMotion(): SceneState {
  const ref = useRef<SceneState | null>(null);
  if (!ref.current) ref.current = { open: new Follower(), thick: [0, 1, 2, 3].map(() => new Follower()), dial: new DialMotion() };
  return ref.current;
}

/** Advance the motion one frame and describe the scene to paint. */
export function advanceScene(
  st: SceneState,
  engine: GalaxyEngine,
  layout: GalaxyLayout,
  path: EnginePath,
  lensOn: boolean,
  extra: Pick<BezelScene, 'hover' | 'lit' | 'waiting' | 'avoid'>,
): BezelScene {
  const f = engine.getFlight();
  const open = st.open.next(lensOn ? 1 : 0, f.id, f.e, f.flying);
  const g = glassFor(engine.getViewport());
  const lvl = levelOf(path);
  const thick = BAND_LEVEL.map((L, i) =>
    (st.thick[i] as Follower).next((L === Math.min(4, lvl + 1) ? 24 : L <= lvl ? 14 : 8) * g.sc, f.id, f.e, f.flying),
  );
  const ix = dialIndex(layout);
  const focus = focusNode(path);
  st.dial.step(mapAngles(ix, focus, path.technique), f.id, f.flying ? f.e : 1);
  const focusPath = new Set([path.domain, path.category, path.subject, path.technique].filter((n) => n !== null));
  return {
    cx: g.cx,
    cy: g.cy,
    rg: g.rp * (1 + 0.45 * (1 - open)),
    sc: g.sc,
    open,
    thick,
    focusPath: focusPath as BezelScene['focusPath'],
    childOf: (n) => {
      if (path.technique) return false;
      if (!focus) return n.kind === 'domain';
      if (focus.kind === 'domain') return n.kind === 'category' && n.domain === focus;
      if (focus.kind === 'category') return n.kind === 'subject' && n.category === focus;
      return n.kind === 'technique' && n.subject === focus;
    },
    pinned: path.technique,
    ...extra,
  };
}
