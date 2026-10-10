// Soundings — ATHENA'S HANDS. The chart's answer to the canvas action grammar
// (canvasActionStore): she pans, focuses, fits, reads a project or a reading,
// and opens one, and each of those is one of the same verbs the keyboard uses.
//
// Extracted from SoundingsView 2026-10-06.
import { useCallback, useEffect, useRef } from 'react';

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
import { useCanvasTestBridge } from '../lib/canvasTestBridge';
import { useCanvasFocus } from '../lib/focusStore';
import type { DimKey } from '../lib/dimRegistry';
import { useEventCallback } from '../lib/useEventCallback';
import { categoryOf, LANES } from './soundingsModel';
import type { SoundingsModel } from './useSoundings';
import { FILE, ms, sleep } from './useSoundingsNav';

export function useSoundingsCanvas(model: SoundingsModel) {
  const { props, scene, stations, indexOf, nav, geo, pointOf, words } = model;
  const { m, tx, laneLabel } = words;
  const { level, curSlug, say, ping, goL0, goL1, goDim, setMarked, setBusy } = nav;
  const { size, card, chartRef } = geo;

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
        if (a.band === 'far' || a.band === 'mid') { nav.setFocusSlug(a.slug); goL0(); }
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
  }, [actionVersion, runAction, setBusy]);

  // Dev/test door into the same grammar (window.__mmCanvas, dev builds only).
  useCanvasTestBridge();

  // Athena composing a panel for a project points the page at it (focusStore);
  // with `travel` the chart opens that station. A focus set before the chart
  // mounted (she composed from elsewhere in the app) is honoured once the
  // stations it names have arrived.
  const canvasFocus = useCanvasFocus();
  const seenFocus = useRef(0);
  useEffect(() => {
    if (!canvasFocus?.travel || canvasFocus.seq === seenFocus.current) return;
    const i = indexOf.get(canvasFocus.target.slug);
    if (i === undefined) return;
    seenFocus.current = canvasFocus.seq;
    goL1(i);
  }, [canvasFocus, indexOf, goL1]);
}
