// How the fused stage gives its chrome room, on the camera's own curve.
//
// The column on the left, the dock at the bottom and the technique document
// on the right are INSETS the engine eases on the flight that re-frames the
// focus into the room left over (`GalaxyEngine.setInsets`). The dock's
// visible height and the column's bottom edge are then read back from the
// engine every frame it draws, so they rise and sink WITH the field instead
// of snapping beside it - and cost nothing while the field rests.
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

import type { GalaxyEngine, StageInsets } from '../engine/GalaxyEngine';
import type { HudMode } from './hudMode';
import { useFusedStore } from './fusedStore';

/** The folded dock: the head plus one strip of care cells. */
export const CARE_H = 104;
/** A short window with a tall dock tightens the column's rhythm. */
const TIGHT_BELOW = 470;

export function docWidth(stageW: number, navW: number): number {
  return Math.round(Math.max(460, Math.min(800, (stageW - navW) * 0.6)));
}

/** The insets one mode asks for. The lens leans left when there is slack. */
export function insetsFor(mode: HudMode, size: { w: number; h: number }, navW: number, dockH: number, docW: number): StageInsets {
  if (mode === 'lens') return { l: navW, r: docW || Math.min(100, Math.max(0, size.w - navW - size.h)), b: 0 };
  return { l: navW - 22, r: docW, b: mode === 'bar' ? dockH : 0 };
}

export function useStageSize(stageRef: RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageRef]);
  return size;
}

interface FrameArgs {
  engine: GalaxyEngine | null;
  stageRef: RefObject<HTMLElement | null>;
  navRef: RefObject<HTMLElement | null>;
  size: { w: number; h: number };
  /** The dock's height when it is up: folded or spread. */
  dockH: number;
}

export function useStageFrame({ engine, stageRef, navRef, size, dockH }: FrameArgs): void {
  const mode = useFusedStore((s) => s.mode);
  const technique = useFusedStore((s) => s.technique);
  const initStage = useFusedStore((s) => s.initStage);
  const followStage = useFusedStore((s) => s.followStage);

  // The first measured size picks the default mode; later sizes follow it
  // until the reader chooses.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!size.w || !size.h) return;
    if (!ready) {
      initStage(size.w, size.h);
      setReady(true);
    } else followStage(size.w, size.h);
  }, [size.w, size.h, ready, initStage, followStage]);

  useEffect(() => {
    if (!engine || !ready || !size.w) return;
    const navW = navRef.current?.getBoundingClientRect().width ?? 284;
    const docW = technique ? docWidth(size.w, navW) : 0;
    stageRef.current?.style.setProperty('--doc-w', `${docWidth(size.w, navW)}px`);
    engine.setInsets(insetsFor(mode, size, navW, dockH, docW));
  }, [engine, ready, mode, technique, size, dockH, navRef, stageRef]);

  // Read back every frame: the dock shows exactly the bottom inset the flight
  // has eased to, and the column ends where the dock begins.
  useEffect(() => {
    if (!engine) return;
    let tight = false;
    const apply = () => {
      const stage = stageRef.current;
      if (!stage) return;
      const b = Math.max(0, engine.getInsets().b);
      stage.style.setProperty('--dock-h', `${b.toFixed(1)}px`);
      stage.style.setProperty('--dock-vis', `${b.toFixed(1)}`);
      const next = stage.clientHeight - b < TIGHT_BELOW;
      if (next !== tight) {
        tight = next;
        navRef.current?.classList.toggle('tight', tight);
      }
    };
    apply();
    return engine.onFrame(apply);
  }, [engine, stageRef, navRef]);
}
