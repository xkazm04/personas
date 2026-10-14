import { Suspense, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Crumbs, KitHost } from '@/features/shared/components/kit';
import { lazyRetry } from '@/lib/lazyRetry';
import { useTranslation } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import { outcomeName, stationName } from '../../labels';
import type { ProcessViewProps } from '../types';
import { DialCaption } from './DialCaption';
import { DialHub } from './DialHub';
import { DialLeft } from './DialLeft';
import { DialLegend } from './DialLegend';
import { useDialData } from './useDialData';
import { useDialEngine } from './useDialEngine';
import { useDialNav } from './useDialNav';
import { useFillHeight } from './useFillHeight';
import './dial.css';

// Level 1 and 2 (the ring's own surface, the session list and sheet) cost the dial nothing until opened.
const DialDeep = lazyRetry(() => import('./DialDeep'));

/** The page's repository door. Optional: a host that does not pass it leaves the bezel and the failing-repository rows read-only. */
export interface DialViewProps extends ProcessViewProps {
  onRepoChange?: (repo: string | null) => void;
}

const FLOOR = 520;

/**
 * The Dial: one tick ring per phase, outermost first; every tick is 1/120 of the sessions. The lit
 * arc is who reached the phase, cut into went on / ended clean / ended failing; the bezel wraps every
 * repository around it. Click a ring and it unrolls into a ruler; below it the step kinds, the failing
 * repositories and the sessions themselves.
 */
export default function DialView(props: DialViewProps) {
  const { t } = useTranslation();
  const p = t.companions.process;
  const { mode, repo, model, base, onRepoChange } = props;
  const data = useDialData(props);
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const baseCv = useRef<HTMLCanvasElement>(null);
  const fxCv = useRef<HTMLCanvasElement>(null);
  const skip = useRef<(() => void) | null>(null);
  const height = useFillHeight(host, FLOOR);
  const nav = useDialNav(data.figs.length, host);
  const [hover, setHover] = useState<number | null>(null);
  const [hoverRepo, setHoverRepo] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [intro, setIntro] = useState(false);
  const [deepSeen, setDeepSeen] = useState(false);
  const first = useRef(true);
  const theme = useThemeStore(useShallow((s) => [s.themeId, s.brightness, s.highContrast, s.cvdSafe, s.dim, s.reduceMotion, s.customTheme] as const));
  const introMs = first.current ? 2400 : 1400;
  useEffect(() => { first.current = false; }, []);

  const fig = nav.q != null ? data.figs[nav.q] : undefined;
  const tint = hover != null ? data.figs[hover]?.keys : nav.level >= 1 ? fig?.keys : undefined;
  useDialEngine(
    {
      rings: data.rings, arcs: data.arcs, repo, level: nav.level, q: nav.level >= 1 ? nav.q : null, hover: nav.level === 0 ? hover : null,
      hoverRepo: nav.level === 0 ? hoverRepo : null, outcome: nav.level === 0 ? outcome : null, tint: tint?.[0] ?? null,
      introKey: `${mode}|${repo ?? ''}`, introMs, themeKey: JSON.stringify(theme), still: theme[5],
      onHover: setHover, onHoverRepo: setHoverRepo, onOpenRing: nav.openStation, onPickRepo: (n) => onRepoChange?.(n), onIntro: setIntro,
    },
    { host, box, ruler, base: baseCv, fx: fxCv, skip },
  );

  // A new mode starts at the dial; a new repository does too when the sessions were open.
  const { home, level, q: navQ } = nav;
  const at = useRef({ level, q: navQ });
  at.current = { level, q: navQ };
  useEffect(() => { home(); setHover(null); setHoverRepo(null); }, [mode, home]);
  useEffect(() => { if (at.current.level === 2) home(); }, [repo, home]);
  useEffect(() => {
    if (level >= 1) setDeepSeen(true);
    const id = window.setTimeout(() => {
      const q = at.current.q;
      if (level === 0 && q == null) return;
      const sel = level === 1 ? '.dial-acts button:not([disabled]), .dial-panel button:not([disabled])' : level === 0 ? `[data-testid="dial-row-${q}"]` : '.dial-sx-list';
      host.current?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
    }, level === 0 ? 780 : level === 1 ? 1100 : 560);
    return () => window.clearTimeout(id);
  }, [level]);

  const crumbs = [
    { label: p.dial.crumb_root, onPress: nav.home },
    ...(nav.drill && 'outcome' in nav.drill
      ? [{ label: outcomeName(p, nav.drill.outcome) }]
      : fig ? [{ label: stationName(p, fig.keys), onPress: nav.level === 2 ? nav.toStation : undefined }, ...(nav.level === 2 ? [{ label: p.dial.sx_aria }] : [])] : []),
  ];
  const keys = nav.level === 0 ? [['↑ ↓', p.dial.keys_phases], ['Enter', p.dial.keys_open]] : nav.level === 1 ? [['← →', p.dial.keys_next], ['Esc', p.dial.keys_back]] : [['↑ ↓', p.dial.keys_sessions], ['Esc', p.dial.keys_back]];

  return (
    <div ref={host} className="dial" tabIndex={-1} data-level={nav.level} data-hover={hover != null ? '1' : '0'} data-intro={intro ? '1' : undefined} data-testid="process-dial" style={{ height }}>
      <div className="dial-backdrop" aria-hidden="true" />
      <canvas ref={baseCv} className="dial-canvas" aria-hidden="true" />
      <canvas ref={fxCv} className="dial-canvas" aria-hidden="true" />

      <main className="dial-stage" inert={nav.level > 0}>
        <DialLeft model={model} figs={data.figs} onOpenStation={nav.openStation} onOutcomeHover={setOutcome} onOpenOutcome={nav.openOutcome} onHover={setHover} />
        <div className="dial-centre">
          <div ref={box} className="dial-box">
            <DialHub model={model} base={base} repo={repo} figs={data.figs} arcs={data.arcs} hover={hover} hoverRepo={hoverRepo} mode={mode} introMs={introMs} />
          </div>
          <DialCaption arcs={data.arcs} />
        </div>
        <DialLegend figs={data.figs} rings={data.rings} hover={hover} arrive={`${mode}|${repo ?? ''}`} onOpenStation={nav.openStation} onHover={setHover} />
      </main>

      {deepSeen && (
        <Suspense fallback={null}>
          <DialDeep view={props} data={data} level={nav.level} q={nav.q} drill={nav.drill} seq={nav.seq} rows={height >= 900 ? 5 : height >= 760 ? 4 : 3} rulerRef={ruler} onOpenSessions={nav.openSessions} onPickRepo={onRepoChange} />
        </Suspense>
      )}

      {nav.level > 0 && (
        <div className="dial-crumbs" data-dial-chrome>
          <KitHost><Crumbs items={crumbs} label={p.dial.crumb_aria} /></KitHost>
        </div>
      )}
      <p className="dial-keys typo-caption" aria-hidden="true">
        {keys.map(([k, label]) => <span key={label}><kbd>{k}</kbd> {label}</span>)}
      </p>
      <button type="button" data-skip data-on={intro ? '' : undefined} tabIndex={intro ? 0 : -1} onClick={() => skip.current?.()}>{p.dial.skip}</button>
    </div>
  );
}
