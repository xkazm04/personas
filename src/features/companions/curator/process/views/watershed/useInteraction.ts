import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { FlowEngine } from './flow';
import { hitSettlement, paintFocus, regionTitle } from './focus';
import type { Scene } from './useScene';

interface Args {
  root: RefObject<HTMLDivElement | null>;
  region: RefObject<SVGTextElement | null>;
  engine: RefObject<FlowEngine | null>;
  scene: Scene | null;
  level: 0 | 1 | 2;
  station: number | null;
  /** The region title for a station index, or the mode's name for null. */
  titleFor: (q: number | null) => string;
  reduce: boolean;
  introActive: () => boolean;
  skipIntro: () => void;
  openStation: (q: number) => void;
  goUp: () => boolean;
}

/**
 * Pointer and keyboard for the map. Pointer moves are coalesced to one rAF and hit-tested by
 * distance against the settlements; the focused station is a ref, and the DOM is repainted
 * (`paintFocus`) only when it changes. No React state moves on hover.
 */
export function useInteraction(a: Args) {
  const args = useRef(a);
  useLayoutEffect(() => { args.current = a; });
  const plateHover = useRef<number | null>(null);
  const mapHover = useRef<number | null>(null);
  const shown = useRef<number | null | undefined>(undefined);
  const ptr = useRef({ x: 0, y: 0, raf: 0 });
  const titleTimer = useRef({ timer: 0 });

  const repaint = useCallback((force = false) => {
    const { root, region, engine, station, titleFor, reduce } = args.current;
    const hover = plateHover.current ?? mapHover.current;
    if (!force && shown.current === hover) return;
    shown.current = hover;
    if (root.current) paintFocus(root.current, hover, station);
    const f = hover ?? station;
    regionTitle(region.current, titleFor(f), f != null, reduce, titleTimer.current);
    if (engine.current) engine.current.focus = hover ?? station;
  }, []);

  // A new scene or depth redraws the marks; paint the current focus onto them.
  useEffect(() => { repaint(true); }, [a.scene, a.station, a.level, repaint]);
  useEffect(() => {
    const p = ptr.current, tt = titleTimer.current;
    return () => { cancelAnimationFrame(p.raf); window.clearTimeout(tt.timer); };
  }, []);
  // "Press any key to skip" holds wherever focus is, not only inside the stage. It never consumes
  // the key, so whatever else the key does still happens.
  useAppKeyboard(() => { if (args.current.introActive()) args.current.skipIntro(); return false; });

  const onPlateHover = useCallback((q: number | null) => { plateHover.current = q; repaint(); }, [repaint]);

  const probe = useCallback(() => {
    ptr.current.raf = 0;
    const { root, scene, level } = args.current;
    const el = root.current;
    if (!el || !scene) return;
    let q: number | null = null;
    if (level === 0) {
      const r = el.getBoundingClientRect();
      const { g } = scene;
      q = hitSettlement(g.x, g.yc, 24 * g.U, ptr.current.x - r.left, ptr.current.y - r.top);
    }
    el.toggleAttribute('data-hit', q != null);
    if (q !== mapHover.current) { mapHover.current = q; repaint(); }
  }, [repaint]);

  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    ptr.current.x = e.clientX;
    ptr.current.y = e.clientY;
    args.current.engine.current?.wake();
    if (!ptr.current.raf) ptr.current.raf = requestAnimationFrame(probe);
  }, [probe]);

  const onPointerLeave = useCallback(() => {
    if (mapHover.current == null) return;
    mapHover.current = null;
    args.current.root.current?.removeAttribute('data-hit');
    repaint();
  }, [repaint]);

  const onPointerDownCapture = useCallback(() => { if (args.current.introActive()) args.current.skipIntro(); }, []);

  const onClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const q = mapHover.current;
    if (q == null || (e.target as Element).closest('button, aside')) return;
    mapHover.current = null;
    args.current.openStation(q);
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const s = args.current;
    s.engine.current?.wake();
    if (s.introActive()) {
      s.skipIntro();
      if (e.key !== 'Tab') { e.preventDefault(); return; }
    }
    if (e.key === 'Escape' && s.goUp()) e.preventDefault();
  }, []);

  return { onPlateHover, handlers: { onPointerMove, onPointerLeave, onPointerDownCapture, onClick, onKeyDown } };
}
