// Soundings — the Mastermind portfolio as a nautical sounding chart, where
// DEPTH MEANS URGENCY. The owner's pick from the 2026-09 next-gen contest
// (docs/design/mastermind-soundings.md); it sits beside the Baseline until it
// is fine-tuned.
//
//   L0 chart    every project a buoy at its urgency depth, reasons on the
//               waterline, relations as currents along the seabed
//   L1 station  the station widens into a water column; readings sit in four
//               lanes x the same four bands; the rest shrink to slivers
//   L2 sample   one reading (or, with I, the project file) rises into a card
//
// Everything positional comes from soundingsGeometry (pure) and every number
// from soundingsModel (pure); this file holds the level, the focus, and the
// wiring to the page's real handlers and to Athena's canvas action queue.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { BaseModal } from '@/lib/ui/BaseModal';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

import {
  dimReadPayload,
  islandReadPayload,
  takeCanvasActions,
  useCanvasActionVersion,
  type CanvasActionFailReason,
  type CanvasActionRequest,
  type CanvasActionResult,
  type CanvasCameraReadout,
} from '../lib/canvasActionStore';
import type { DimKey } from '../lib/dimRegistry';
import { IslandJumpPalette } from '../lib/IslandJumpPalette';
import type { DimNode, Scene } from '../lib/types';
import { useEventCallback } from '../lib/useEventCallback';
import { ProjectFile, ReadingCard, useStatusWord, type Anchor, type CardHandlers } from './SoundingsCard';
import {
  anchorX,
  buoyDepth,
  cardBox,
  chartGeometry,
  currentArc,
  layoutColumn,
  spatialMove,
  stationSpan,
  STRIP_BOTTOM,
  wavePath,
  type ArrowKey,
  type Box,
  type ColumnReading,
  type Level,
} from './soundingsGeometry';
import {
  buildStations,
  categoryOf,
  daysLate,
  LANES,
  laneScore,
  rankStations,
  relatedStations,
  stationReasons,
  topReading,
  visibleEdges,
  type Reason,
} from './soundingsModel';
import { FlagGlyph, Ladder, SonarGlyph, STATUS_COLOR, StatusMark, Tide, TideGlyph, toolText } from './soundingsParts';
import './soundings.css';

export interface SoundingsViewProps {
  scene: Scene;
  /** The view switcher, rendered in the chart's own top bar. */
  switcher?: ReactNode;
  onDimOpen: (slug: string, node: DimNode, anchor: Anchor) => void;
  onFleetOpen: (sessionId: string) => void;
  onPersonasOpen: (slug: string, anchor: Anchor) => void;
  onShipOpen: (slug: string) => void;
  onFactoryOpen: (slug: string) => void;
  onDispatchFleet: (slug: string) => void;
  onOpenTerminal: (slug: string) => void;
  canOpenTerminal: (slug: string) => boolean;
}

/** The lifted key for the project file (not a dimension). */
const FILE = '@file' as const;
type LiftKey = DimKey | typeof FILE;
type LiftPhase = 'start' | 'grow' | 'open' | 'sink';

interface LogLine { id: number; who: 'athena' | 'chart'; text: string; time: string }
interface Ping { id: number; x: number; y: number }

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ms = (full: number, reduced: number) => (reducedMotion() ? reduced : full);
const sleep = (t: number) => new Promise<void>((r) => { window.setTimeout(r, t); });
let seq = 0;

export default function SoundingsView(props: SoundingsViewProps) {
  const { scene, switcher } = props;
  const { t, tx } = useTranslation();
  const m = t.mastermind;
  const statusWord = useStatusWord();

  // ── data ────────────────────────────────────────────────────────────────
  const stations = useMemo(() => buildStations(scene.islands), [scene.islands]);
  const n = stations.length;
  const indexOf = useMemo(() => new Map(stations.map((s) => [s.island.slug, s.index])), [stations]);
  const rank = useMemo(() => rankStations(stations), [stations]);
  const rankOf = useCallback((i: number) => rank.indexOf(i), [rank]);
  const edges = useMemo(() => visibleEdges(scene.edges, indexOf), [scene.edges, indexOf]);

  // ── navigation state (slugs, so a data refresh that reorders never moves the focus) ──
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
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);
  const [booted, setBooted] = useState(false);
  const [settled, setSettled] = useState(false);

  const cur = curSlug !== null ? indexOf.get(curSlug) ?? null : null;
  const focus = (focusSlug !== null ? indexOf.get(focusSlug) : undefined) ?? rank[0] ?? 0;
  const curStation = cur !== null ? stations[cur] ?? null : null;

  // A station that vanished (hidden, removed) cannot stay open.
  useEffect(() => {
    if (level > 0 && cur === null) { setLevel(0); setLift(null); }
  }, [level, cur]);

  // ── measurement ─────────────────────────────────────────────────────────
  const chartRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s && Math.abs(s.W - r.width) < 1 && Math.abs(s.H - r.height) < 1 ? s : { W: r.width, H: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // First paint develops from a ghost: buoys start on the seabed and float up.
  useEffect(() => {
    if (!size || booted) return;
    let a = 0;
    let b = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setBooted(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [size, booted]);
  useEffect(() => {
    if (!booted) return;
    const id = window.setTimeout(() => setSettled(true), 1800);
    return () => window.clearTimeout(id);
  }, [booted]);

  const g = useMemo(() => (size ? chartGeometry(size.W, size.H, Math.max(1, n)) : null), [size, n]);
  const colSpan = g && cur !== null ? stationSpan(g, cur, 1, cur, n) : null;

  const readings = useMemo<ColumnReading[]>(() => (curStation
    ? curStation.island.nodes.map((node) => ({
      key: node.key,
      status: node.status,
      category: categoryOf(node.key),
      twoLine: Boolean(node.detail) || node.status === 'unknown',
    }))
    : []), [curStation]);
  const column = useMemo(() => (g && colSpan && readings.length ? layoutColumn(g, colSpan.w, readings) : null), [g, colSpan, readings]);
  const card = g ? cardBox(g, lift?.key === FILE) : null;

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
  const wantFocus = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
    if (level === 2 && cur === i) { openCard(k); return; }
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
    setLog((l) => [...l.slice(-2), { id: ++seq, who, text, time }]);
  }, []);

  const ping = useCallback((x: number, y: number) => {
    const id = ++seq;
    setPings((p) => [...p, { id, x, y }]);
    later(() => setPings((p) => p.filter((q) => q.id !== id)), 2800);
  }, [later]);

  /** Where a station or reading sits right now, in chart coordinates. */
  const pointOf = useCallback((i: number, key?: DimKey | null): { x: number; y: number } | null => {
    if (!g) return null;
    const s = stations[i];
    if (!s) return null;
    if (level === 0 || cur === null) {
      const r = stationSpan(g, i, 0, 0, n);
      return { x: r.l + r.w / 2, y: buoyDepth(g, s.metrics.urgency) };
    }
    if (i !== cur) {
      const r = stationSpan(g, i, level, cur, n);
      return { x: r.l + r.w / 2, y: buoyDepth(g, s.metrics.urgency) };
    }
    const f = key && column ? column.frames[key] : undefined;
    if (f && colSpan) return { x: colSpan.l + f.x + 12, y: f.y + f.h / 2 };
    if (colSpan) return { x: colSpan.l + colSpan.w / 2, y: STRIP_BOTTOM - 22 };
    return null;
  }, [g, stations, level, cur, n, column, colSpan]);

  // ── keyboard helpers ────────────────────────────────────────────────────
  const relMemo = useRef<{ origin: number; k: number; at: number } | null>(null);
  const awIdx = useRef(-1);

  const relStep = useCallback(() => {
    const here = level === 0 ? focus : cur ?? focus;
    const origin = relMemo.current && relMemo.current.at === here ? relMemo.current.origin : here;
    const rel = relatedStations(origin, edges, indexOf);
    const from = stations[origin];
    if (!from) return;
    if (!rel.length) { say('chart', tx(m.soundings_log_no_currents, { name: from.island.name })); return; }
    const k = relMemo.current && relMemo.current.origin === origin ? (relMemo.current.k + 1) % rel.length : 0;
    const to = rel[k]!;
    relMemo.current = { origin, k, at: to };
    if (level === 0) { setFocusSlug(stations[to]!.island.slug); wantFocus.current = true; }
    else if (level === 1) goL1(to);
    else goDim(to, lift?.key ?? FILE);
    const edge = edges.find((e) => (indexOf.get(e.from) === origin && indexOf.get(e.to) === to) || (indexOf.get(e.to) === origin && indexOf.get(e.from) === to));
    const params = { from: from.island.name, to: stations[to]!.island.name, label: edge?.label ?? '' };
    say('chart', edge?.label ? tx(m.soundings_log_current_label, params) : tx(m.soundings_log_current, params));
  }, [level, focus, cur, edges, indexOf, stations, say, tx, m, goL1, goDim, lift]);

  const awaitingStep = useCallback(() => {
    const list = stations.flatMap((s) => s.island.fleet.filter((f) => f.state === 'awaiting_input').map((f) => ({ i: s.index, f })));
    if (!list.length) { say('chart', m.soundings_log_none_waiting); return; }
    awIdx.current = (awIdx.current + 1) % list.length;
    const { i, f } = list[awIdx.current]!;
    if (!(level === 1 && cur === i)) goL1(i);
    setFlash(f.id);
    later(() => setFlash((x) => (x === f.id ? null : x)), 2400);
    say('chart', tx(m.soundings_log_waiting, { session: f.label, name: stations[i]!.island.name }));
  }, [stations, level, cur, goL1, later, say, tx, m]);

  useAppKeyboard((e) => {
    if (jumpOpen || helpOpen) return false;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return false;
    // Only while the owner is in the chart: keys typed into another panel are not ours.
    const ae = document.activeElement;
    if (ae && ae !== document.body && !rootRef.current?.contains(ae)) return false;
    if (n === 0) return false;
    const k = e.key;
    if (k !== 'r' && k !== 'R' && k !== 'Shift') relMemo.current = null;

    if (k.startsWith('Arrow')) {
      e.preventDefault();
      const dir = k as ArrowKey;
      if (level === 0) {
        // Left/right walk the fixed order; up/down walk the urgency ranking.
        const byRank = () => rank[Math.max(0, Math.min(n - 1, rankOf(focus) + (dir === 'ArrowUp' ? -1 : 1)))] ?? focus;
        const next = dir === 'ArrowLeft' ? Math.max(0, focus - 1) : dir === 'ArrowRight' ? Math.min(n - 1, focus + 1) : byRank();
        setFocusSlug(stations[next]!.island.slug);
        wantFocus.current = true;
        return true;
      }
      if (e.shiftKey && (dir === 'ArrowLeft' || dir === 'ArrowRight') && cur !== null) {
        const to = Math.max(0, Math.min(n - 1, cur + (dir === 'ArrowLeft' ? -1 : 1)));
        if (to !== cur) { if (level === 2) goDim(to, lift?.key ?? FILE); else goL1(to); }
        return true;
      }
      if (column && readKey) {
        const nk = spatialMove(column.frames, readKey, dir);
        if (nk) {
          if (level === 2) openCard(nk);
          else { setReadKey(nk); wantFocus.current = true; }
        }
      }
      return true;
    }
    if (k === 'Enter') {
      if (ae instanceof HTMLButtonElement && !ae.dataset.sd) return false; // a real button: let it click
      e.preventDefault();
      if (level === 0) goL1(focus);
      else if (level === 1 && readKey) openCard(readKey);
      return true;
    }
    if (k === 'Escape') {
      if (level === 2) { closeCard(); return true; }
      if (level === 1) { goL0(); return true; }
      if (marked.size) { setMarked(new Set()); return true; }
      return false;
    }
    if (k === '/') { e.preventDefault(); setJumpOpen(true); return true; }
    if (k === '?') { e.preventDefault(); setHelpOpen(true); return true; }
    const lk = k.toLowerCase();
    if (lk === 'a') { awaitingStep(); return true; }
    if (lk === 'r') { relStep(); return true; }
    if (lk === 'i') { toggleFile(); return true; }
    if (lk === 'h' || k === 'Home') { e.preventDefault(); goL0(); return true; }
    return false;
  }, { priority: ROUTE_DECISION_PRIORITY });

  // ── Athena: answer the same canvas action grammar the Baseline answers ──
  const camera = useCallback((): CanvasCameraReadout => ({
    x: 0,
    y: 0,
    z: level === 0 ? 0.1 : 1,
    band: level === 0 ? 'far' : 'close',
    viewport: { w: size?.W ?? 0, h: size?.H ?? 0 },
    visibleSlugs: level === 0 || !curSlug ? stations.map((s) => s.island.slug) : [curSlug],
  }), [level, size, curSlug, stations]);

  const pointAt = useCallback((i: number, key?: DimKey | null) => {
    const p = pointOf(i, key);
    if (p) ping(p.x, p.y);
  }, [pointOf, ping]);

  const runAction = useEventCallback(async (a: CanvasActionRequest): Promise<Omit<CanvasActionResult, 'seq'>> => {
    const fail = (reason: CanvasActionFailReason) => ({ ok: false as const, reason, camera: camera() });
    const ok = (payload?: unknown) => ({ ok: true as const, ...(payload !== undefined ? { payload } : {}), camera: camera() });
    const flight = ms(760, 90);
    switch (a.kind) {
      case 'camera.read':
      case 'camera.pan':
        return ok();
      case 'camera.zoom':
        if (a.band === 'far' || (typeof a.factor === 'number' && a.factor < 1)) { goL0(); await sleep(flight); }
        return ok();
      case 'camera.focus': {
        const i = indexOf.get(a.slug);
        if (i === undefined) return fail('unknown_slug');
        say('athena', tx(m.soundings_log_focus, { name: stations[i]!.island.name }));
        if (a.band === 'far' || a.band === 'mid') { setFocusSlug(a.slug); goL0(); }
        else goL1(i);
        await sleep(flight);
        pointAt(i);
        return ok();
      }
      case 'camera.fit': {
        const slugs = a.slugs ?? [];
        if (slugs.some((s) => !indexOf.has(s))) return fail('unknown_slug');
        goL0();
        setMarked(new Set(slugs));
        say('athena', slugs.length ? tx(m.soundings_log_fit_some, { count: slugs.length }) : m.soundings_log_fit);
        await sleep(flight);
        for (const s of slugs) pointAt(indexOf.get(s)!);
        return ok();
      }
      default: {
        if (scene.demo) return fail('demo_scene');
        const i = indexOf.get(a.slug);
        if (i === undefined) return fail('unknown_slug');
        const island = stations[i]!.island;
        if (a.kind === 'island.read') { say('athena', tx(m.soundings_log_read, { name: island.name })); return ok(islandReadPayload(island)); }
        if (a.kind === 'island.menu') {
          say('athena', tx(m.soundings_log_menu, { name: island.name }));
          goDim(i, FILE);
          await sleep(flight);
          return ok({ terminalEnabled: props.canOpenTerminal(island.slug), navEnabled: !scene.demo });
        }
        if (a.kind === 'category.open') {
          const lane = LANES.find((l) => l === a.category);
          if (!lane) return fail('unknown_target');
          const first = island.nodes.find((nd) => categoryOf(nd.key) === lane);
          if (!first) return fail('unknown_target');
          say('athena', tx(m.soundings_log_category, { category: laneLabel(lane), name: island.name }));
          goL1(i, first.key);
          await sleep(flight);
          pointAt(i, first.key);
          return ok({ key: lane, total: island.nodes.filter((nd) => categoryOf(nd.key) === lane).length });
        }
        const node = island.nodes.find((nd) => nd.key === a.key);
        if (!node) return fail('unknown_target');
        if (a.kind === 'dim.read') return ok(dimReadPayload(node));
        // dim.open: lift the reading, then open its Improve surface exactly as a click would.
        say('athena', tx(m.soundings_log_dim, { dim: node.label, name: island.name }));
        setMarked(new Set([`${island.slug}:${node.key}`]));
        goDim(i, node.key);
        await sleep(flight + ms(420, 20));
        const r = chartRef.current?.getBoundingClientRect();
        if (r && card) props.onDimOpen(island.slug, node, { clientX: r.left + card.x + 60, clientY: r.top + card.y + 120 });
        return ok(dimReadPayload(node));
      }
    }
  });

  const actionVersion = useCanvasActionVersion();
  useEffect(() => {
    const entries = takeCanvasActions();
    if (entries.length === 0) return;
    void (async () => {
      setBusy(true);
      for (const entry of entries) {
        const result = await runAction(entry.action);
        entry.settle({ seq: entry.seq, ...result });
      }
      setBusy(false);
    })();
  }, [actionVersion, runAction]);

  // ── words ───────────────────────────────────────────────────────────────
  const bandName = [m.soundings_band_surface, m.soundings_band_shallows, m.soundings_band_midwater, m.soundings_band_deep];
  const bandMean = [m.soundings_band_surface_mean, m.soundings_band_shallows_mean, m.soundings_band_midwater_mean, m.soundings_band_deep_mean];
  function laneLabel(lane: (typeof LANES)[number]): string {
    return { runtime: m.dim_cat_runtime, delivery: m.dim_cat_delivery, agentic: m.dim_cat_agentic, product: m.dim_cat_product }[lane];
  }
  const reasonText = (r: Reason): string => {
    switch (r.kind) {
      case 'alerts': return tx(r.count === 1 ? m.soundings_reason_alerts_one : m.soundings_reason_alerts_other, { count: r.count ?? 0 });
      case 'risks': return tx(r.count === 1 ? m.soundings_reason_risks_one : m.soundings_reason_risks_other, { count: r.count ?? 0 });
      case 'stalled': return m.soundings_reason_stalled;
      case 'critical': return m.soundings_reason_critical;
      case 'late': return tx(m.soundings_reason_late, { name: r.name ?? '' });
      case 'waiting': return tx(m.soundings_reason_waiting, { name: r.name ?? '' });
      case 'unbound': return m.soundings_reason_unbound;
    }
  };

  // ── derived paint state ─────────────────────────────────────────────────
  const act = level === 0 ? hover ?? focus : cur ?? focus;
  const relatedToCur = useMemo(() => new Set(cur !== null ? relatedStations(cur, edges, indexOf) : []), [cur, edges, indexOf]);
  const b1 = level >= 1 && column ? column.b1 : g?.b1 ?? 0;
  const b2 = level >= 1 && column ? column.b2 : g?.b2 ?? 0;
  const liftedKey = lift && lift.phase !== 'sink' ? lift.key : null;

  const sourceBox = (k: LiftKey): Box | null => {
    if (!colSpan) return null;
    if (k === FILE) return { x: colSpan.l + 14, y: 6, w: colSpan.w - 28, h: 50 };
    const f = column?.frames[k];
    return f ? { x: colSpan.l + f.x, y: f.y, w: f.w, h: f.h } : card;
  };
  const plateBox = lift ? (lift.phase === 'start' || lift.phase === 'sink' ? sourceBox(lift.key) : card) : null;

  const handlers: CardHandlers | null = curStation ? {
    onImprove: (node, anchor) => props.onDimOpen(curStation.island.slug, node, anchor),
    onCompare: (i) => goDim(i, lift?.key ?? FILE),
    onFollow: (i, edge) => {
      goDim(i, FILE);
      const params = { from: curStation.island.name, to: stations[i]!.island.name, label: edge.label ?? '' };
      say('chart', edge.label ? tx(m.soundings_log_current_label, params) : tx(m.soundings_log_current, params));
    },
    onSession: (id) => props.onFleetOpen(id),
    onPersonas: (anchor) => props.onPersonasOpen(curStation.island.slug, anchor),
    onShip: () => props.onShipOpen(curStation.island.slug),
    onFactory: () => props.onFactoryOpen(curStation.island.slug),
    onDispatch: () => props.onDispatchFleet(curStation.island.slug),
    onTerminal: () => props.onOpenTerminal(curStation.island.slug),
    canTerminal: props.canOpenTerminal(curStation.island.slug),
  } : null;

  // ── the reading line ────────────────────────────────────────────────────
  let reading: ReactNode = null;
  if (n > 0) {
    if (level === 2 && liftedKey && liftedKey !== FILE && curStation) {
      const node = curStation.island.nodes.find((x) => x.key === liftedKey);
      if (node) reading = <><b>{node.label}</b>{` ${tx(m.soundings_reading_dim, { dim: '', project: curStation.island.name, status: statusWord(node.status) }).trimStart()}`}</>;
    } else {
      const s = stations[act];
      if (s) {
        const r = rankOf(act);
        const head = r === 0 ? tx(m.soundings_reading_first, { name: '\u0000' }) : tx(m.soundings_reading_nth, { name: '\u0000', rank: r + 1 });
        const [pre, post] = head.split('\u0000');
        const rs = stationReasons(s);
        reading = (
          <>
            {pre}<b>{s.island.name}</b>{post}
            {': '}
            {rs.length === 0 ? m.soundings_calm : rs.map((x, k) => (
              <span key={x.kind}>{k > 0 ? ', ' : ''}<span className={x.kind === 'alerts' ? 'sd-al' : undefined}>{reasonText(x)}</span></span>
            ))}
          </>
        );
      }
    }
  }

  const keysForLevel: Array<[string[], string]> = [
    [['←', '→', '↑', '↓'], ''],
    ...(level < 2 ? [[['↵'], level === 0 ? m.soundings_key_open : m.soundings_key_lift] as [string[], string]] : []),
    ...(level >= 1 ? [[['I'], m.soundings_key_details] as [string[], string]] : []),
    ...(level >= 1 ? [[['Esc'], m.soundings_key_up] as [string[], string]] : []),
    [['/'], m.soundings_key_find],
    [['A'], m.soundings_key_waiting],
    [['R'], m.soundings_key_related],
    [['?'], m.soundings_key_all],
  ];

  const onChartClick = (e: React.MouseEvent<HTMLElement>) => {
    const tgt = e.target as HTMLElement;
    if (tgt === e.currentTarget || tgt.dataset.water !== undefined) {
      if (level === 2) closeCard();
      else if (level === 1) goL0();
    }
  };

  const rootCls = ['sd-root', booted ? '' : 'sd-ghost', settled ? 'sd-settled' : '', busy ? 'sd-busy' : ''].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={rootCls} data-level={level} data-testid="mm-soundings">
      <header className="sd-top">
        <nav className="sd-crumbs" aria-label={m.soundings_where}>
          <button type="button" aria-current={level === 0 ? 'location' : undefined} onClick={goL0}>{m.world_portfolio}</button>
          {level >= 1 && curStation && (
            <>
              <span className="sd-sep" aria-hidden>{'›'}</span>
              <button type="button" aria-current={level === 1 ? 'location' : undefined} onClick={() => { if (level === 2) closeCard(); }}>{curStation.island.name}</button>
            </>
          )}
          {level === 2 && curStation && liftedKey && (
            <>
              <span className="sd-sep" aria-hidden>{'›'}</span>
              <button type="button" aria-current="location">
                {liftedKey === FILE ? m.soundings_details : curStation.island.nodes.find((x) => x.key === liftedKey)?.label}
              </button>
            </>
          )}
        </nav>
        <p className="sd-reading" aria-live="polite">{reading}</p>
        {switcher}
        <button type="button" className="sd-topbtn" aria-label={m.soundings_help_aria} onClick={() => setHelpOpen(true)}>?</button>
        {g && (
          <div className="sd-hair" aria-hidden>
            {stations.map((s) => {
              const r = stationSpan(g, s.index, level, cur ?? 0, n);
              return <i key={s.island.slug} data-mc={s.metrics.mark} style={{ left: r.l + 1, width: Math.max(2, r.w - 2) }} />;
            })}
          </div>
        )}
      </header>

      <main ref={chartRef} className="sd-chart" aria-label={m.soundings_chart_label} onClick={onChartClick}>
        {g && (
          <>
            <div className="sd-air" data-water="" style={{ height: g.wl }} />
            <div className="sd-sea" data-water="" style={{ top: g.wl }} />
            <svg className="sd-contours" viewBox={`0 0 ${g.W} ${g.H}`} aria-hidden>
              <path d={wavePath(b1, g.W, 1.6, 0)} />
              <path d={wavePath(b2, g.W, 1.6, 1)} />
              <path className="sd-minor" d={wavePath(Math.round((g.wl + b1) / 2), g.W, 1.2, 1)} />
              <path className="sd-minor" d={wavePath(Math.round((b1 + b2) / 2), g.W, 1.2, 0)} />
              <path className="sd-minor" d={wavePath(Math.round((b2 + g.bed) / 2), g.W, 1.2, 1)} />
              <path className="sd-bedline" d={`M0 ${g.bed} L${g.W} ${g.bed}`} />
            </svg>
            <div className="sd-ripple" style={{ top: g.wl - 6 }} aria-hidden><i /><i /></div>
            <div className="sd-seabed" data-water="" style={{ height: g.H - g.bed }} />
            <div className="sd-legend" style={{ width: g.legend }} aria-hidden>
              {[Math.round(g.wl * 0.62), Math.round((g.wl + b1) / 2), Math.round((b1 + b2) / 2), Math.round((b2 + g.bed) / 2)].map((y, k) => (
                <div key={k} className="sd-lg" style={{ top: y }}>
                  <span className="sd-nm typo-label">{bandName[k]}</span>
                  <span className="sd-mn">{bandMean[k]}</span>
                </div>
              ))}
              <span className="sd-snd sd-wlab" style={{ top: g.wl }}>6</span>
              <span className="sd-snd" style={{ top: b1 }}>2</span>
              <span className="sd-snd" style={{ top: b2 }}>1</span>
            </div>

            <svg className="sd-currents" viewBox={`0 0 ${g.W} ${g.H}`} aria-hidden>
              {edges.map((e) => {
                const a = indexOf.get(e.from)!;
                const b = indexOf.get(e.to)!;
                const arc = currentArc(anchorX(g, a, b, level, cur ?? 0, n), anchorX(g, b, a, level, cur ?? 0, n), g);
                const on = a === act || b === act;
                const cls = [e.kind === 'similarity' ? 'sd-sim' : '', on ? 'sd-on' : level === 0 ? 'sd-dim' : 'sd-gone'].filter(Boolean).join(' ');
                return <path key={`${e.from}-${e.to}-${e.kind}`} className={cls} d={arc.d} />;
              })}
            </svg>

            <div className="sd-stations">
              {stations.map((s) => {
                const i = s.index;
                const r = stationSpan(g, i, level, cur ?? 0, n);
                const sm = s.metrics;
                const y = booted && !s.ghost ? buoyDepth(g, sm.urgency) : g.bed - 18;
                const cls = [
                  'sd-st',
                  hover === i ? 'sd-hov' : '',
                  level === 0 && focus === i ? 'sd-foc' : '',
                  level > 0 && i !== cur ? 'sd-sl' : '',
                  level > 0 && i === cur ? 'sd-cur' : '',
                  i === rank[0] && sm.urgency > 0 ? 'sd-top1' : '',
                  sm.waiting ? 'sd-aw' : '',
                  level > 0 && relatedToCur.has(i) ? 'sd-rel' : '',
                  s.ghost ? 'sd-ghoststation' : '',
                ].filter(Boolean).join(' ');
                const rs = stationReasons(s);
                const aria = s.ghost
                  ? tx(m.soundings_ghost_aria, { name: s.island.name })
                  : rs.length
                    ? tx(m.soundings_buoy_aria_why, { name: s.island.name, band: bandName[sm.band]!, reasons: rs.map(reasonText).join(', ') })
                    : tx(m.soundings_buoy_aria, { name: s.island.name, band: bandName[sm.band]! });
                const style = { left: r.l, width: r.w, '--y': y, '--wl': g.wl, '--i': i, '--mc': STATUS_COLOR[sm.mark] } as CSSProperties;
                return (
                  <div
                    key={s.island.slug}
                    className={cls}
                    data-band={sm.band}
                    data-mc={sm.mark}
                    style={style}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                  >
                    <div className="sd-pl" />
                    <div className="sd-line" />
                    <div className="sd-floats" aria-hidden>
                      {sm.waiting && <span className="sd-fl-aw"><FlagGlyph /></span>}
                      {sm.alerts > 0 && <span className="sd-fl-al">{sm.alerts}</span>}
                      {sm.late && <span className="sd-fl-late"><TideGlyph />{m.world_late}</span>}
                    </div>
                    <div className="sd-tick" />
                    <div className="sd-sldot" />
                    <span className="sd-vtag">{s.island.name}</span>
                    <button
                      ref={(el) => { if (el) buoyRefs.current.set(s.island.slug, el); else buoyRefs.current.delete(s.island.slug); }}
                      type="button"
                      className="sd-buoy"
                      data-sd="buoy"
                      tabIndex={level === 0 && focus === i ? 0 : -1}
                      aria-label={aria}
                      data-testid={`sd-buoy-${s.island.slug}`}
                      onClick={(e) => { e.stopPropagation(); if (level === 0) goL1(i); }}
                      onFocus={() => { if (level === 0 && focus !== i) setFocusSlug(s.island.slug); }}
                    >
                      <span className="sd-nm typo-title-lg">{s.island.name}</span>
                      <span className={marked.has(s.island.slug) ? 'sd-bm sd-marked' : 'sd-bm'}><StatusMark status={sm.mark} /></span>
                    </button>
                    <button
                      type="button"
                      className="sd-slbtn"
                      tabIndex={-1}
                      aria-label={s.island.name}
                      onClick={(e) => { e.stopPropagation(); goL1(i); }}
                    />
                  </div>
                );
              })}
            </div>

            {level >= 1 && curStation && colSpan && column && (
              <div className="sd-col" key={curStation.island.slug} style={{ left: colSpan.l, width: colSpan.w }}>
                <button
                  type="button"
                  className={liftedKey === FILE ? 'sd-strip sd-lifted' : 'sd-strip'}
                  aria-label={tx(m.soundings_strip_aria, { name: curStation.island.name })}
                  data-testid="sd-strip"
                  onClick={(e) => { e.stopPropagation(); openCard(FILE); }}
                >
                  <div>
                    <span className="sd-in-l typo-label">{m.world_fleet}</span>
                    <span className="sd-in-v">
                      {curStation.island.fleet.length === 0 && curStation.island.personasRunning.length === 0 && <span className="sd-muted">{m.lane_none}</span>}
                      {curStation.island.fleet.map((f) => (
                        <span key={f.id} className={flash === f.id ? 'sd-sess sd-flash' : 'sd-sess'} data-state={f.state}>
                          <i />
                          {(f.state === 'awaiting_input' || curStation.island.fleet.length < 3) && f.label}
                          {f.state === 'awaiting_input' && <em>{m.fleet_awaiting}</em>}
                        </span>
                      ))}
                      {curStation.island.personasRunning.length > 0 && (
                        <span className="sd-muted">{tx(curStation.island.personasRunning.length === 1 ? m.far_personas_one : m.far_personas_other, { count: curStation.island.personasRunning.length })}</span>
                      )}
                    </span>
                  </div>
                  <div>
                    <span className="sd-in-l typo-label">{m.world_next_ship}</span>
                    <span className="sd-in-v">
                      {curStation.island.ship?.next ? (
                        <>
                          <span>{curStation.island.ship.next}</span>
                          <Tide ship={curStation.island.ship} />
                          <span className="typo-data">{`${curStation.island.ship.shipped}/${curStation.island.ship.total}`}</span>
                          {curStation.island.ship.late
                            ? <span className="sd-late-t">{tx(m.soundings_late_days, { days: daysLate(curStation.island.ship.targetDate, Date.now()) })}</span>
                            : curStation.island.ship.targetDate && <span className="sd-muted">{tx(m.milestone_bar_target, { date: curStation.island.ship.targetDate })}</span>}
                        </>
                      ) : <span className="sd-muted">{m.soundings_none_planned}</span>}
                    </span>
                  </div>
                  <div>
                    <span className="sd-in-l typo-label">{m.world_llm_spend}</span>
                    <span className="sd-in-v typo-data">{curStation.island.stats.find((x) => x.key === 'llm')?.value ?? '-'}</span>
                  </div>
                  <div>
                    <span className="sd-in-l typo-label">{m.soundings_errors}</span>
                    <span className="sd-in-v">
                      {curStation.island.monitorErrors === null
                        ? <span className="sd-muted">{m.soundings_not_bound}</span>
                        : <span className="typo-data">{curStation.island.monitorErrors}</span>}
                    </span>
                  </div>
                  <div>
                    <span className="sd-in-l typo-label">{m.soundings_blockers}</span>
                    <span className="sd-in-v typo-data">{curStation.island.blockers}</span>
                  </div>
                  <div className="sd-in-more"><kbd>I</kbd><span>{m.soundings_details}</span></div>
                </button>
                <div className="sd-lanes" aria-hidden>
                  {LANES.map((lane) => {
                    const sc = laneScore(curStation.island, lane);
                    return <span key={lane} className="typo-label">{laneLabel(lane)}<b>{`${sc.solid}/${sc.total}`}</b></span>;
                  })}
                </div>
                {column.lanes.map((x) => <div key={x} className="sd-ldiv" style={{ left: x, top: g.wl + 6, height: g.bed - g.wl - 12 }} />)}
                {curStation.island.nodes.map((node) => {
                  const f = column.frames[node.key];
                  if (!f) return null;
                  const second = node.detail ? toolText(node.detail) : node.status === 'unknown' ? m.soundings_could_not_read : '';
                  const cls = [
                    'sd-fr',
                    f.one ? 'sd-one' : '',
                    f.tight ? 'sd-tight' : '',
                    readKey === node.key && level >= 1 ? 'sd-foc' : '',
                    liftedKey === node.key ? 'sd-lifted' : '',
                    marked.has(`${curStation.island.slug}:${node.key}`) ? 'sd-marked' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <button
                      key={node.key}
                      ref={(el) => { if (el) frameRefs.current.set(node.key, el); else frameRefs.current.delete(node.key); }}
                      type="button"
                      className={cls}
                      data-sd="frame"
                      data-band={node.status === 'solid' ? 3 : undefined}
                      data-testid={`sd-frame-${node.key}`}
                      tabIndex={readKey === node.key ? 0 : -1}
                      style={{ left: f.x, top: f.y, width: f.w, height: f.h, '--c': STATUS_COLOR[node.status] } as CSSProperties}
                      aria-label={node.detail
                        ? tx(m.soundings_frame_aria_detail, { dim: node.label, status: statusWord(node.status), detail: toolText(node.detail) })
                        : tx(m.soundings_frame_aria, { dim: node.label, status: statusWord(node.status) })}
                      onClick={(e) => { e.stopPropagation(); setReadKey(node.key); openCard(node.key); }}
                    >
                      <StatusMark status={node.status} />
                      <span className="sd-fl">{node.label}</span>
                      <Ladder node={node} />
                      <span className={node.detail ? 'sd-ff' : 'sd-ff sd-none'}>{second}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="sd-curlabels" aria-hidden>
              {edges.map((e) => {
                if (!e.label) return null;
                const a = indexOf.get(e.from)!;
                const b = indexOf.get(e.to)!;
                const arc = currentArc(anchorX(g, a, b, level, cur ?? 0, n), anchorX(g, b, a, level, cur ?? 0, n), g);
                const on = (a === act || b === act) && (level === 0 || hover === a || hover === b);
                return <span key={`${e.from}-${e.to}-${e.kind}`} className={on ? 'sd-clab sd-on' : 'sd-clab'} style={{ left: arc.labelX, top: arc.labelY }}>{e.label}</span>;
              })}
            </div>

            {lift && plateBox && (
              <div className="sd-plate sd-on" data-phase={lift.phase} style={{ left: plateBox.x, top: plateBox.y, width: plateBox.w, height: plateBox.h }} aria-hidden />
            )}
            {lift && card && curStation && handlers && (
              <section
                ref={cardRef}
                className={lift.phase === 'open' ? 'sd-card sd-show' : 'sd-card'}
                style={{ left: card.x, top: card.y, width: card.w, height: card.h }}
                aria-labelledby="sd-card-title"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
              >
                {lift.key === FILE
                  ? <ProjectFile station={curStation} stations={stations} rankOf={rankOf} edges={edges} related={relatedToCur} g={g} card={card} h={handlers} />
                  : <ReadingCard station={curStation} dimKey={lift.key} stations={stations} g={g} card={card} h={handlers} />}
              </section>
            )}

            <div className="sd-pings" aria-hidden>
              {pings.map((p) => <div key={p.id} className="sd-ping" style={{ left: p.x, top: p.y }}><i /><i /></div>)}
            </div>

            {level >= 1 && hover !== null && hover !== cur && stations[hover] && (() => {
              const r = stationSpan(g, hover, level, cur ?? 0, n);
              const left = hover < (cur ?? 0) ? r.l + r.w + 8 : undefined;
              const right = hover > (cur ?? 0) ? g.W - r.l + 8 : undefined;
              return <div className="sd-tip" style={{ left, right, top: Math.max(4, buoyDepth(g, stations[hover]!.metrics.urgency) - 14) }}>{stations[hover]!.island.name}</div>;
            })()}
          </>
        )}
        {n === 0 && <div className="sd-empty">{m.soundings_empty}</div>}
      </main>

      <footer className="sd-dock">
        <div className="sd-loghead">
          <SonarGlyph />
          <span className="sd-status typo-label">{busy ? m.soundings_athena_moving : m.soundings_athena_idle}</span>
          <div className="sd-keys" aria-hidden>
            {keysForLevel.map(([ks, w]) => (
              <span key={ks.join('')}>{ks.map((x) => <kbd key={x}>{x}</kbd>)}{w}</span>
            ))}
          </div>
        </div>
        <ol className="sd-log" role="log" aria-live="polite" aria-label={m.soundings_log_label}>
          {/* One reserved row: the latest move. A fixed three-line well sat empty
              most of the time (reserve the row, not the maximum). */}
          {log.slice(-1).map((l) => (
            <li key={l.id} className={l.who === 'athena' ? 'sd-ath' : undefined}>
              <time>{l.time}</time>
              <b className="typo-label">{l.who === 'athena' ? m.soundings_who_athena : m.soundings_who_chart}</b>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
      </footer>

      {jumpOpen && (
        <IslandJumpPalette
          islands={stations.map((s) => s.island)}
          onJump={(slug) => { const i = indexOf.get(slug); if (i !== undefined) goL1(i); }}
          onMiss={(query) => say('chart', tx(m.jump_missed, { query }))}
          onClose={() => setJumpOpen(false)}
        />
      )}

      <BaseModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} titleId="sd-help-title" size="lg">
        <SoundingsHelp />
      </BaseModal>
    </div>
  );
}

function SoundingsHelp() {
  const { t } = useTranslation();
  const m = t.mastermind;
  const statusWord = useStatusWord();
  const keys: Array<[string[], string]> = [
    [['←', '→'], m.soundings_help_move],
    [['↑', '↓'], m.soundings_help_urgency],
    [['↵'], m.soundings_help_open],
    [['I'], m.soundings_help_file],
    [['Esc'], m.soundings_help_esc],
    [['⇧', '←→'], m.soundings_help_neighbour],
    [['/'], m.soundings_help_find],
    [['A'], m.soundings_help_waiting],
    [['R'], m.soundings_help_related],
    [['H'], m.soundings_help_home],
    [['?'], m.soundings_help_sheet],
  ];
  return (
    <div className="sd-root-vars sd-help">
      <h2 id="sd-help-title" className="typo-heading-lg">{m.soundings_help_title}</h2>
      <div>
        <h3 className="typo-label">{m.soundings_help_keys}</h3>
        <dl>
          {keys.map(([ks, w]) => (
            <div key={w} style={{ display: 'contents' }}>
              <dt>{ks.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
              <dd>{w}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h3 className="typo-label">{m.soundings_depth}</h3>
        <p>{m.soundings_help_depth_l0}</p>
        <p>{m.soundings_help_depth_l1}</p>
        <h3 className="typo-label">{m.soundings_help_legend}</h3>
        {(['alert', 'risk', 'absent', 'unknown', 'partial', 'solid'] as const).map((s) => (
          <div key={s} className="sd-lgrow"><StatusMark status={s} />{statusWord(s)}</div>
        ))}
        <p>{m.soundings_unknown_note}</p>
        <div className="sd-lgrow"><FlagGlyph />{m.soundings_help_flag}</div>
      </div>
    </div>
  );
}
