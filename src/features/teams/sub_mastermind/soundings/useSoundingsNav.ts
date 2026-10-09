// Soundings — WHERE THE OWNER IS, and the verbs that move him.
//
// Extracted from SoundingsView 2026-10-06. The view was 1,015 lines holding the
// level machine, the lift animation, the DOM-focus follower, the dock log, the
// keyboard grammar, Athena's action grammar and a nine-region render in one
// function. This file owns only the first four: everything here is state plus a
// verb that writes it, and nothing here knows a pixel.
//
// Navigation is keyed by SLUG, never by index, so a data refresh that reorders
// the portfolio never moves the focus out from under the owner.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DimKey } from '../lib/dimRegistry';
import { topReading, type Station } from './soundingsModel';
import type { Level } from './soundingsGeometry';

/** The lifted key for the project file (not a dimension). */
export const FILE = '@file' as const;
export type LiftKey = DimKey | typeof FILE;
export type LiftPhase = 'start' | 'grow' | 'open' | 'sink';

export interface LogLine { id: number; who: 'athena' | 'chart'; text: string; time: string }
export interface Ping { id: number; x: number; y: number }

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const ms = (full: number, reduced: number) => (reducedMotion() ? reduced : full);
export const sleep = (t: number) => new Promise<void>((r) => { window.setTimeout(r, t); });

let seq = 0;
/** The next React key for a transient row (a dock log line, a sonar ping).
 *  Spelled as a function, not `++seq` at the call site, because the latter is
 *  the shape of a staleness guard and this is not one: nothing awaits on it. */
function nextKey(): number { seq += 1; return seq; }

export type SoundingsNav = ReturnType<typeof useSoundingsNav>;

export function useSoundingsNav(stations: readonly Station[], indexOf: ReadonlyMap<string, number>, rank: readonly number[]) {
  const [level, setLevel] = useState<Level>(0);
  const [curSlug, setCurSlug] = useState<string | null>(null);
  const [focusSlug, setFocusSlug] = useState<string | null>(null);
  const [readKey, setReadKey] = useState<DimKey | null>(null);
  const [lastKey, setLastKey] = useState<DimKey | null>(null);
  const [lift, setLift] = useState<{ key: LiftKey; phase: LiftPhase } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const cur = curSlug !== null ? indexOf.get(curSlug) ?? null : null;
  const focus = (focusSlug !== null ? indexOf.get(focusSlug) : undefined) ?? rank[0] ?? 0;
  const curStation = cur !== null ? stations[cur] ?? null : null;
  const liftedKey = lift && lift.phase !== 'sink' ? lift.key : null;

  // A station that vanished (hidden, removed) cannot stay open.
  useEffect(() => {
    if (level > 0 && cur === null) { setLevel(0); setLift(null); }
  }, [level, cur]);

  // ── timers (cancelled on unmount) ───────────────────────────────────────
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, t0: number) => {
    const id = window.setTimeout(() => { timers.current = timers.current.filter((x) => x !== id); fn(); }, t0);
    timers.current.push(id);
  }, []);
  useEffect(() => () => { for (const id of timers.current) window.clearTimeout(id); }, []);

  // ── the plate: a frame rises into the card and sinks back ───────────────
  const liftPhase = lift?.phase ?? null;
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let timer = 0;
    if (liftPhase === 'start') {
      raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setLift((l) => (l && l.phase === 'start' ? { ...l, phase: 'grow' } : l))); });
    } else if (liftPhase === 'grow') {
      timer = window.setTimeout(() => setLift((l) => (l && l.phase === 'grow' ? { ...l, phase: 'open' } : l)), ms(400, 0));
    } else if (liftPhase === 'sink') {
      timer = window.setTimeout(() => setLift((l) => (l && l.phase === 'sink' ? null : l)), ms(520, 60));
    }
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); window.clearTimeout(timer); };
  }, [liftPhase]);

  // ── DOM focus follows the keyboard ──────────────────────────────────────
  const buoyRefs = useRef(new Map<string, HTMLButtonElement>());
  const frameRefs = useRef(new Map<DimKey, HTMLButtonElement>());
  const cardRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);
  useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    if (level === 0) buoyRefs.current.get(stations[focus]?.island.slug ?? '')?.focus({ preventScroll: true });
    else if (level === 1 && readKey) frameRefs.current.get(readKey)?.focus({ preventScroll: true });
    else if (level === 2) cardRef.current?.focus({ preventScroll: true });
  });

  // ── verbs shared by the owner and Athena ────────────────────────────────
  const goL0 = useCallback(() => {
    setLift(null);
    setLevel(0);
    if (curSlug) setFocusSlug(curSlug);
    wantFocus.current = true;
  }, [curSlug]);

  const goL1 = useCallback((i: number, key?: DimKey | null) => {
    const s = stations[i];
    if (!s) return;
    setLift(null);
    setCurSlug(s.island.slug);
    setFocusSlug(s.island.slug);
    setReadKey(key ?? topReading(s.island));
    setLevel(1);
    wantFocus.current = true;
  }, [stations]);

  const openCard = useCallback((k: LiftKey) => {
    if (level === 0) return;
    if (k !== FILE) { setReadKey(k); setLastKey(k); }
    setLift((l) => (l && level === 2 && l.phase !== 'sink' ? { key: k, phase: 'open' } : { key: k, phase: 'start' }));
    setLevel(2);
    wantFocus.current = true;
  }, [level]);

  const closeCard = useCallback(() => {
    if (!lift) return;
    setLevel(1);
    setLift({ ...lift, phase: 'sink' });
    if (lift.key === FILE) setReadKey((k) => lastKey ?? k ?? (curStation ? topReading(curStation.island) : null));
    wantFocus.current = true;
  }, [lift, lastKey, curStation]);

  /** Open station `i` and lift `k` in one move (a relation, a comparison, Athena). */
  const goDim = useCallback((i: number, k: LiftKey) => {
    if (level >= 1 && cur === i) { openCard(k); return; }
    goL1(i, k === FILE ? null : k);
    later(() => {
      setLift({ key: k, phase: 'start' });
      setLevel(2);
      if (k !== FILE) { setReadKey(k); setLastKey(k); }
    }, ms(720, 80));
  }, [level, cur, openCard, goL1, later]);

  const toggleFile = useCallback(() => {
    if (level === 0) { goDim(focus, FILE); return; }
    if (level === 2 && lift?.key === FILE) { closeCard(); return; }
    openCard(FILE);
  }, [level, focus, lift, goDim, closeCard, openCard]);

  // ── the dock's log and Athena's sonar ───────────────────────────────────
  const say = useCallback((who: LogLine['who'], text: string) => {
    const time = new Date().toTimeString().slice(0, 5);
    setLog((l) => [...l.slice(-2), { id: nextKey(), who, text, time }]);
  }, []);

  const ping = useCallback((x: number, y: number) => {
    const id = nextKey();
    setPings((p) => [...p, { id, x, y }]);
    later(() => setPings((p) => p.filter((q) => q.id !== id)), 2800);
  }, [later]);

  return {
    level, cur, curSlug, curStation, focus, readKey, lift, liftedKey, hover, marked, flash, pings, log, busy, jumpOpen, helpOpen,
    setFocusSlug, setReadKey, setHover, setMarked, setFlash, setBusy, setJumpOpen, setHelpOpen,
    goL0, goL1, openCard, closeCard, goDim, toggleFile, say, ping, later, wantFocus,
    buoyRefs, frameRefs, cardRef, rootRef,
  };
}
