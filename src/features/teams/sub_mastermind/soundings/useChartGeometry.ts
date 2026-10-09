// Soundings — WHERE EVERYTHING SITS. The chart's own measurement loop plus the
// pure layout calls it feeds (soundingsGeometry), kept apart from the view so a
// position is never computed in the middle of a render that also decides what a
// word says.
//
// Extracted from SoundingsView 2026-10-06 together with useSoundingsNav.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  buoyDepth,
  cardBox,
  chartGeometry,
  layoutColumn,
  placeLabels,
  stationSpan,
  type ColumnReading,
  type LabelSlot,
  type Level,
} from './soundingsGeometry';
import { categoryOf, type Station } from './soundingsModel';
import { FILE, type LiftKey } from './useSoundingsNav';

export interface ChartGeometryInput {
  stations: readonly Station[];
  rank: readonly number[];
  level: Level;
  cur: number | null;
  curStation: Station | null;
  liftKey: LiftKey | null;
  buoyRefs: React.RefObject<Map<string, HTMLButtonElement>>;
}

export type ChartGeometry = ReturnType<typeof useChartGeometry>;

export function useChartGeometry({ stations, rank, level, cur, curStation, liftKey, buoyRefs }: ChartGeometryInput) {
  const n = stations.length;
  const [size, setSize] = useState<{ W: number; H: number } | null>(null);
  const [booted, setBooted] = useState(false);
  const [settled, setSettled] = useState(false);

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
  const card = g ? cardBox(g, liftKey === FILE) : null;

  // ── buoy names that do not collide (placeLabels) ────────────────────────
  // Widths are the rendered names' own, measured after paint; a hidden name
  // keeps its box (opacity, not display), so it stays measurable.
  const [nameW, setNameW] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    for (const s of stations) {
      const el = buoyRefs.current?.get(s.island.slug)?.querySelector<HTMLElement>('.sd-nm');
      next[s.island.slug] = el?.offsetWidth ?? 0;
    }
    setNameW((prev) => {
      const keys = Object.keys(next);
      return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
    });
  }, [stations, size, buoyRefs]);

  const labelSlots = useMemo<Record<number, LabelSlot>>(() => {
    if (!g || level !== 0) return {};
    const items = stations.filter((s) => !s.ghost).map((s) => {
      const r = stationSpan(g, s.index, 0, 0, n);
      return { i: s.index, cx: r.l + r.w / 2, y: buoyDepth(g, s.metrics.urgency), w: nameW[s.island.slug] ?? 0 };
    });
    return placeLabels(items, rank);
  }, [g, level, stations, n, nameW, rank]);

  return { chartRef, size, booted, settled, g, colSpan, column, card, labelSlots };
}
