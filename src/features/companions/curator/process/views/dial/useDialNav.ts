import { useCallback, useState, type RefObject } from 'react';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { Drill } from './DialDeep';
import type { SessionBucket } from './dialDetail';

/**
 * Where the reader is in the Dial: the dial (0), a ring unrolled (1), the sessions behind a figure (2).
 * Plain state; the camera and the scene both follow it. `q` is kept after closing so the scene can
 * leave without going blank.
 */
interface Nav { level: 0 | 1 | 2; q: number | null; drill: Drill; seq: number }

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || !!el.closest?.('[role="listbox"]:not([data-dial-sessions-list]),[role="dialog"],[role="menu"]'));
};

export function useDialNav(stations: number, host: RefObject<HTMLElement | null>) {
  const [nav, set] = useState<Nav>({ level: 0, q: null, drill: null, seq: 0 });

  const openStation = useCallback((q: number) => set((n) => (n.level === 2 ? n : { ...n, level: 1, q, seq: n.seq + 1 })), []);
  const walk = useCallback((dir: number) => set((n) => {
    const q = n.q == null ? null : n.q + dir;
    return n.level !== 1 || q == null || q < 0 || q >= stations ? n : { ...n, q, seq: n.seq + 1 };
  }), [stations]);
  const openSessions = useCallback((b: SessionBucket) => set((n) => ({ ...n, level: 2, drill: { bucket: b } })), []);
  const openOutcome = useCallback((o: string) => set((n) => ({ ...n, level: 2, q: null, drill: { outcome: o } })), []);
  const back = useCallback(() => set((n) => (n.level === 0 ? n : n.level === 2 && n.q != null ? { ...n, level: 1 } : { ...n, level: 0 })), []);
  const toStation = useCallback(() => set((n) => (n.q != null ? { ...n, level: 1 } : { ...n, level: 0 })), []);
  // Same object back when already home: a mode change calls this and must not cost a render.
  const home = useCallback(() => set((n) => (n.level === 0 ? n : { ...n, level: 0 })), []);

  // Keys: Esc / Backspace back out, arrows walk the phases (level 0) or the rings (level 1). Registered on the app's
  // ladder at the route-decision rung, so a modal or the palette above it wins the key first.
  useAppKeyboard((e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isEditable(e.target)) return false;
    const el = host.current;
    if (!el || !el.isConnected) return false;
    if (e.key === 'Escape' || e.key === 'Backspace') {
      if (nav.level === 0) return false;
      e.preventDefault();
      back();
      return true;
    }
    if (nav.level === 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const rows = [...el.querySelectorAll<HTMLElement>('.dial-legend button')];
      const cur = rows.indexOf(document.activeElement as HTMLElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = cur < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, cur + step));
      rows[next]?.focus();
      e.preventDefault();
      return true;
    }
    if (nav.level === 1 && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      walk(e.key === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
      return true;
    }
    return false;
  }, { priority: ROUTE_DECISION_PRIORITY });

  return { ...nav, openStation, walk, openSessions, openOutcome, back, toStation, home };
}
