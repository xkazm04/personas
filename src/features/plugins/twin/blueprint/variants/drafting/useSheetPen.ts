import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SECTION_IDS } from '../../blueprintContract';

/**
 * Marks on the sheet the pen can travel to, by key (`region:voice`,
 * `topic:opinions`, `goal:g5`, `channel:email`, `title`, `notes`). The ref
 * callback per key is stable, so registering never re-renders anything.
 */
export function useMarkRegistry() {
  const els = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const register = useCallback((key: string) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (el: HTMLElement | null) => {
        if (el) els.current.set(key, el);
        else els.current.delete(key);
      };
      refs.current.set(key, ref);
    }
    return ref;
  }, []);
  const find = useCallback((key: string | null): HTMLElement | null => {
    if (!key) return null;
    const el = els.current.get(key) ?? null;
    // A mark moved out of a short sheet (display: none) has no box to point at.
    return el && el.getClientRects().length > 0 ? el : null;
  }, []);
  return { register, find };
}

/** While the engine works with no question, the pen visits each region in turn. */
const VISIT_MS = 2400;

/**
 * Where the pen is: wherever the sheet is drawing (`drawAt`, the draw-in's
 * waypoints); otherwise at the mark the last answer landed on; touring the
 * regions while the engine works; otherwise lifted off the sheet. Never under
 * reduced motion.
 */
export function useSheetPen({
  drawAt,
  targetKey,
  targetSection,
  working,
  active,
  reduced,
  find,
}: {
  drawAt: HTMLElement | null;
  targetKey: string | null;
  targetSection: string | null;
  working: boolean;
  /** The pen belongs on this view once it is drawn (stage); a drawing's own waypoints bring it to any view. */
  active: boolean;
  reduced: boolean;
  find: (key: string | null) => HTMLElement | null;
}): HTMLElement | null {
  const [visit, setVisit] = useState(0);
  const touring = active && !reduced && !drawAt && working && !targetKey;
  useEffect(() => {
    if (!touring) return;
    const timer = window.setInterval(() => setVisit((v) => v + 1), VISIT_MS);
    return () => window.clearInterval(timer);
  }, [touring]);

  const key = !active || reduced
    ? null
    : targetKey
      ? targetKey
      : touring
        ? `region:${SECTION_IDS[visit % SECTION_IDS.length]}`
        : null;
  const fallback = targetSection ? `region:${targetSection}` : null;

  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // A mark may name a finer place for the nib (`pen:<key>`), clear of its words.
    setEl(find(key ? `pen:${key}` : null) ?? find(key) ?? (key === targetKey ? find(fallback) : null));
  }, [find, key, fallback, targetKey]);
  if (reduced) return null;
  return drawAt ?? el;
}

/** The two ends of the stage leader: the notes cell and the mark the answer landed on. */
export function useLeaderEnds(
  targetKey: string | null,
  /** The sheet stands drawn: the marks are where they will stay. */
  drawn: boolean,
  find: (key: string | null) => HTMLElement | null,
): { from: HTMLElement | null; to: HTMLElement | null } {
  const [ends, setEnds] = useState<{ from: HTMLElement | null; to: HTMLElement | null }>({ from: null, to: null });
  useLayoutEffect(() => {
    setEnds(targetKey ? { from: find('notes'), to: find(targetKey) } : { from: null, to: null });
  }, [targetKey, drawn, find]);
  return ends;
}
