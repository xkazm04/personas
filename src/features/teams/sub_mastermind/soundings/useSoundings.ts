// Soundings — THE MODEL. One hook that assembles the chart: the pure data
// (soundingsModel), where the owner is (useSoundingsNav), where things sit
// (useChartGeometry), the words (soundingsWords), and the handful of paint
// decisions that need all four at once.
//
// Extracted from SoundingsView 2026-10-06, following sub_goals/goalDetail: with
// the data behind a hook and a context, a LAYOUT is a file that arranges blocks
// instead of a file that forwards thirty props.
import { useCallback, useMemo } from 'react';

import type { DimKey } from '../lib/dimRegistry';
import type { Box } from './soundingsGeometry';
import { buoyDepth, stationSpan, STRIP_BOTTOM } from './soundingsGeometry';
import { buildStations, rankStations, relatedStations, visibleEdges } from './soundingsModel';
import { useStatusWord, type CardHandlers } from './SoundingsCard';
import { useChartGeometry } from './useChartGeometry';
import { useSoundingsWords } from './soundingsWords';
import { FILE, useSoundingsNav, type LiftKey } from './useSoundingsNav';
import type { SoundingsViewProps } from './soundingsProps';

export type SoundingsModel = ReturnType<typeof useSoundings>;

export function useSoundings(props: SoundingsViewProps) {
  const { scene, settling = false } = props;
  const words = useSoundingsWords();
  const { m, tx } = words;
  const statusWord = useStatusWord();

  // ── data ────────────────────────────────────────────────────────────────
  const stations = useMemo(() => buildStations(scene.islands), [scene.islands]);
  const n = stations.length;
  const indexOf = useMemo(() => new Map(stations.map((s) => [s.island.slug, s.index])), [stations]);
  const rank = useMemo(() => rankStations(stations), [stations]);
  const rankOf = useCallback((i: number) => rank.indexOf(i), [rank]);
  const edges = useMemo(() => visibleEdges(scene.edges, indexOf), [scene.edges, indexOf]);

  const nav = useSoundingsNav(stations, indexOf, rank);
  const { level, cur, curStation, focus, hover, lift, liftedKey, say, goDim, buoyRefs } = nav;

  const geo = useChartGeometry({
    stations, rank, level, cur, curStation, liftKey: lift?.key ?? null, buoyRefs,
  });
  const { g, colSpan, column, card } = geo;

  // ── derived paint state ─────────────────────────────────────────────────
  const act = level === 0 ? hover ?? focus : cur ?? focus;
  const relatedToCur = useMemo(() => new Set(cur !== null ? relatedStations(cur, edges, indexOf) : []), [cur, edges, indexOf]);
  const b1 = level >= 1 && column ? column.b1 : g?.b1 ?? 0;
  const b2 = level >= 1 && column ? column.b2 : g?.b2 ?? 0;

  const sourceBox = (k: LiftKey): Box | null => {
    if (!colSpan) return null;
    if (k === FILE) return { x: colSpan.l + 14, y: 6, w: colSpan.w - 28, h: 50 };
    const f = column?.frames[k];
    return f ? { x: colSpan.l + f.x, y: f.y, w: f.w, h: f.h } : card;
  };
  const plateBox = lift ? (lift.phase === 'start' || lift.phase === 'sink' ? sourceBox(lift.key) : card) : null;

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

  // The L2 card's doors out of the chart are the page's own handlers.
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
    onRunners: (anchor) => props.onRunnersOpen(curStation.island.slug, anchor),
    onShip: () => props.onShipOpen(curStation.island.slug),
    onFactory: () => props.onFactoryOpen(curStation.island.slug),
    onDispatch: () => props.onDispatchFleet(curStation.island.slug),
    onTerminal: () => props.onOpenTerminal(curStation.island.slug),
    canTerminal: props.canOpenTerminal(curStation.island.slug),
  } : null;

  return {
    props, scene, settling, words, statusWord,
    stations, n, indexOf, rank, rankOf, edges,
    nav, geo, liftedKey,
    act, relatedToCur, b1, b2, plateBox, pointOf, handlers,
  };
}
