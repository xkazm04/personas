import { Suspense, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { useTranslation } from '@/i18n/useTranslation';
import { stationName } from '../../labels';
import type { ProcessViewProps } from '../types';
import { camFor } from './camera';
import { FlowEngine } from './flow';
import { mapIds } from './MapDefs';
import { MapSvg } from './MapSvg';
import { Overlay } from './Overlay';
import { Plates } from './Plates';
import { useInteraction } from './useInteraction';
import { useFillArea } from './useFillArea';
import { useScene } from './useScene';
import { useStageEnv } from './useStageEnv';
import { Voyage } from './Voyage';
import './watershed.css';
import './overlay.css';

// The survey sheet (the deeper levels) is its own chunk, fetched while the map arrives.
const loadSheet = () => import('./sheet/SurveySheet');
const SurveySheet = lazyRetry(loadSheet);

/** Arriving on the view fills the river slowly; a mode or repository change refills it quickly. */
const FIRST_MS = 2000, AGAIN_MS = 900;

export interface Nav { station: number | null; session: string | null }

/**
 * The Watershed: the derived path as a river from spring to sea. Its width is the sessions still
 * flowing; at each settlement the ones that stopped leave it, failing into a red marsh below or
 * clean into a lake above, and the ones that walked the whole path reach a delta with one mouth
 * per outcome. Nothing disappears. Three depths: the map, a settlement's survey sheet, and one
 * session's voyage log.
 */
export default function WatershedView(live: ProcessViewProps) {
  // A mode or repository switch redraws the whole map: let the page's header answer the click
  // first and draw the new map in a deferred, interruptible render behind it.
  const props = useDeferredValue(live);
  const { mode, repo, model, base, reading } = props;
  const { t } = useTranslation();
  const p = t.companions.process;
  const rootRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const regionRef = useRef<SVGTextElement>(null);
  const engineRef = useRef<FlowEngine | null>(null);
  const uid = useId();
  const ids = useMemo(() => mapIds(uid), [uid]);
  useFillArea(rootRef);
  const env = useStageEnv(rootRef, probeRef);
  const scene = useScene(props, env);
  const reduce = env?.reduce ?? false;

  // The depth: reset whenever the mode or repository changes (the map underneath is a new one).
  const viewKey = `${mode}|${repo ?? ''}`;
  const [nav, setNavState] = useState<Nav & { key: string }>({ station: null, session: null, key: viewKey });
  const cur: Nav = nav.key === viewKey ? nav : { station: null, session: null };
  const setNav = useCallback((n: Nav) => setNavState({ ...n, key: viewKey }), [viewKey]);
  const level: 0 | 1 | 2 = cur.session ? 2 : cur.station != null ? 1 : 0;

  // Arrival: its length is fixed per map, so the drawing never re-renders when it ends.
  const [arrival, setArrival] = useState(() => ({ key: viewKey, first: true }));
  if (arrival.key !== viewKey) setArrival({ key: viewKey, first: false });
  const ms = reduce ? 0 : arrival.first ? FIRST_MS : AGAIN_MS;
  const [skippedKey, setSkippedKey] = useState<string | null>(null);
  const skipped = skippedKey === viewKey;
  const introUntil = useRef(0);
  const skipIntro = useCallback(() => { setSkippedKey(viewKey); introUntil.current = 0; engineRef.current?.showNow(); }, [viewKey]);

  const canvasRef = useCallback((node: HTMLCanvasElement | null) => {
    engineRef.current?.destroy();
    engineRef.current = node ? new FlowEngine(node) : null;
  }, []);

  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const e = engineRef.current;
    if (!scene || !env || !e) return;
    const fresh = lastKey.current !== viewKey;
    lastKey.current = viewKey;
    const delay = fresh && !skipped ? ms : 0;
    if (fresh) introUntil.current = performance.now() + delay;
    e.reduce = reduce;
    e.setScene(scene.g, scene.fates, props.view.map((x) => x.id), env.ink, scene.mid, delay);
  }, [scene, env, viewKey, ms, reduce, skipped, props.view]);

  const cam = useMemo(() => (scene ? camFor(scene.g, level, cur.station) : { s: 1, x: 0, y: 0 }), [scene, level, cur.station]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.deep = level > 0;
    e.setZoom(cam.s);
  }, [cam.s, level]);

  // Warm the sheet's chunk once the map is up, so the first descent opens without a wait.
  useEffect(() => {
    if (!scene) return;
    const h = window.setTimeout(() => { void loadSheet(); }, 600);
    return () => window.clearTimeout(h);
  }, [scene]);

  const openStation = useCallback((q: number) => { skipIntro(); setNav({ station: q, session: null }); }, [setNav, skipIntro]);
  const goUp = useCallback(() => {
    if (cur.session) { setNav({ station: cur.station, session: null }); return true; }
    if (cur.station != null) {
      const back = cur.station;
      setNav({ station: null, session: null });
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`.ws-plate[data-q="${back}"]`)?.focus());
      return true;
    }
    return false;
  }, [cur.session, cur.station, setNav]);

  const modeName = mode === 'interactive' ? p.mode_interactive : p.mode_headless;
  const titleFor = useCallback((q: number | null) => (q != null && model.stations[q] ? stationName(p, model.stations[q].keys) : modeName), [model, p, modeName]);
  const { onPlateHover, handlers } = useInteraction({
    root: rootRef, region: regionRef, engine: engineRef, scene, level, station: cur.station, titleFor, reduce,
    introActive: () => !skipped && performance.now() < introUntil.current, skipIntro, openStation, goUp,
  });

  const [sheetEver, setSheetEver] = useState(false);
  if (level > 0 && !sheetEver) setSheetEver(true);
  const outcome = cur.session ? props.view.find((x) => x.id === cur.session)?.outcome ?? 'quiet' : 'quiet';
  const arriving = ms > 0;
  const cls = ['ws-root', level > 0 && 'is-deep', level === 2 && 'is-l3', (skipped || !arriving) && 'is-skipped'].filter(Boolean).join(' ');
  const style = { '--u': scene?.g.U ?? 1, '--ws-reveal': `${ms}ms` } as CSSProperties;

  return (
    <div ref={rootRef} className={cls} style={style} data-testid="watershed-view" tabIndex={-1} {...handlers}>
      <span ref={probeRef} className="ws-probe" aria-hidden="true" />
      <div className="ws-world" style={{ transform: `matrix(${cam.s},0,0,${cam.s},${cam.x},${cam.y})` }}>
        {scene && <MapSvg key={viewKey} scene={scene} ids={ids} revealMs={ms} regionRef={regionRef} svgRef={svgRef} />}
        {scene && cur.session && <Voyage key={cur.session} scene={scene} ids={ids} id={cur.session} outcome={outcome} />}
        <canvas ref={canvasRef} className="ws-flow" aria-hidden="true" />
      </div>
      {scene && env && (
        <div className="ws-overlay" key={viewKey}>
          <Overlay scene={scene} arriving={arriving} />
          <Plates scene={scene} model={model} base={repo ? base : null} measure={env.measure} arriving={arriving} onOpen={openStation} onHover={onPlateHover} />
        </div>
      )}
      {scene && sheetEver && (
        <Suspense fallback={null}>
          <SurveySheet {...props} scene={scene} nav={cur} setNav={setNav} goUp={goUp} reading={reading} />
        </Suspense>
      )}
    </div>
  );
}
