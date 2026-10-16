import { useContext, useEffect, useRef, useState } from 'react';
import { Figure } from '@/features/shared/components/kit';
import { useIsDarkTheme } from '@/stores/themeStore';
import { SheetContext } from '../controller/SheetContext';
import { Engine } from '../engine/Engine';
import type { Safe } from '../engine/camera';
import type { EngineWords, Hooks } from '../engine/types';
import type { Plan } from '../model/plan';
import type { Work } from '../model/work';
import type { ViewStore } from '../state/viewStore';

/** The part of the canvas the chrome leaves free: header, right rail, bottom bars (px from each edge). */
export const SAFE = { l: 8, t: 80, r: 84, b: 84 } as const;

/** The safe area with its top at the title block's real bottom: one band on a wide plan, two on a narrow one (WP4b). */
export function safeOf(host: HTMLElement | null): Safe {
  const plan = host?.closest('.bp-plan'), hd = plan?.querySelector<HTMLElement>('.bp-hd');
  if (!plan || !hd) return SAFE;
  const box = plan.getBoundingClientRect(), bottom = hd.getBoundingClientRect().bottom - box.top;
  // a header taller than a third of the plan is not a laid-out title block (a test DOM measures every box alike)
  return bottom > 0 && bottom < box.height / 3 ? { ...SAFE, t: Math.max(SAFE.t, Math.round(bottom + 10)) } : SAFE;
}

interface Props {
  plan: Plan;
  work: Work;
  words: EngineWords;
  lens: string;
  view: ViewStore;
  /** The latest hooks; read through a ref, so changing them never rebuilds the engine. */
  hooks: Omit<Hooks, 'safe' | 'moved'>;
  onEngine: (e: Engine | null) => void;
  desc: string;
}

/**
 * The drawing, composed INTO the kit's Figure door (doctrine 6c: the kit governs structure, not figure): the frame
 * gives it a declared height, a size container, an accessible name and a text equivalent; the canvas inside is free.
 * The canvas is the figure; it carries no label of its own, because every name on it is also in the queue, the find
 * list and the feature sheet at full type size.
 */
export function PlanCanvas({ plan, work, words, lens, view, hooks, onEngine, desc }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(600);
  const engine = useRef<Engine | null>(null);
  // Stage D: the date the plan is drawn at, the recent window and the picked items (the sheet's state, when there is one)
  const ui = useContext(SheetContext)?.ui;
  const asOf = ui?.asOf ?? null, viewDays = ui?.viewDays ?? 7, selected = ui?.selected;
  const live = useRef({ hooks, plan, work, words, asOf, viewDays, selected });
  live.current = { hooks, plan, work, words, asOf, viewDays, selected };
  const dark = useIsDarkTheme();

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(Math.max(200, Math.round(el.getBoundingClientRect().height))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = cv.current, box = host.current;
    if (!canvas || !box) return;
    const l = live.current;
    const e = new Engine(canvas, box, l.plan, l.words, {
      safe: () => safeOf(box),
      moved: () => view.sync(e),
      hover: (f, t, x, y, r) => live.current.hooks.hover(f, t, x, y, r),
      flag: (f) => live.current.hooks.flag(f),
      click: (t, r, sh) => live.current.hooks.click(t, r, sh),
      descend: (t, x, y) => live.current.hooks.descend(t, x, y),
    });
    e.setWork(l.work); e.setAt(l.asOf); e.setViewDays(l.viewDays); e.setPicked(l.selected ?? []);
    engine.current = e; onEngine(e);
    return () => { e.dispose(); engine.current = null; onEngine(null); };
  // built once per mount (onEngine and view are stable); plan, work, words and lens reach it through the effects below
  }, [onEngine, view]);

  useEffect(() => { const e = engine.current; if (e && e.plan !== plan) e.setPlan(plan); }, [plan]);
  useEffect(() => { engine.current?.setWork(work); }, [work]);
  useEffect(() => { engine.current?.setWords(words); }, [words]);
  useEffect(() => { engine.current?.setLens(lens); }, [lens]);
  // the canvas colours come from tokens: read them again when the theme changes
  useEffect(() => { engine.current?.retheme(); }, [dark]);
  useEffect(() => { engine.current?.setAt(asOf); }, [asOf]);
  useEffect(() => { engine.current?.setViewDays(viewDays); }, [viewDays]);
  useEffect(() => { engine.current?.setPicked(selected ?? []); }, [selected, work]);

  return (
    <div ref={frame} className="bp-frame">
      <Figure label={words.canvasLabel} desc={desc} height={h} className="bp-figure" testId="blueprint-figure">
        <div ref={host} className="bp-host">
          {/* bp's ground: the paper under the canvas (which paints no paper of its own), the vignette and the double frame over it */}
          <div className="bp-paper" aria-hidden="true" />
          <canvas ref={cv} className="bp-canvas" aria-hidden="true" tabIndex={-1} />
          <div className="bp-vig" aria-hidden="true" />
          <div className="bp-dframe" aria-hidden="true" />
        </div>
      </Figure>
    </div>
  );
}
