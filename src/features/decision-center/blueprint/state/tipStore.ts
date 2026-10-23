// The hover card's state, outside the sheet's reducer: the pointer moves many times a second and only the card
// itself should re-render for it.
import { useSyncExternalStore } from 'react';
import type { FlagBox } from '../engine/types';

export interface TipSnap {
  /** The feature under the pointer, or the first of a cluster. */
  fid: string | null;
  /** A hovered flag (a trouble mark), if the pointer is on one. */
  flag: FlagBox | null;
  /** The room under the pointer when no fixture or flag is (bp's place card); null otherwise. */
  room: string | null;
  px: number;
  py: number;
}

export class TipStore {
  snap: TipSnap | null = null;
  private subs = new Set<() => void>();
  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  get = (): TipSnap | null => this.snap;
  set(next: TipSnap | null): void {
    const o = this.snap;
    if (o === next || (o && next && o.fid === next.fid && o.flag === next.flag && o.room === next.room && o.px === next.px && o.py === next.py)) return;
    this.snap = next;
    for (const fn of this.subs) fn();
  }
}

export const useTip = (s: TipStore): TipSnap | null => useSyncExternalStore(s.subscribe, s.get);
