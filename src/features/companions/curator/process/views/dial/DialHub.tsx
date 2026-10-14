import { useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { pct, stationName } from '../../labels';
import type { DevMode } from '../../engine/devAdapter';
import type { SpineModel } from '../../engine/spine';
import { DialEmblem } from './DialEmblem';
import { ease, fmtInt } from './dialFormat';
import type { Figure, RepoArc } from './dialModel';
import { tintVar } from './dialPalette';

interface HubProps {
  model: SpineModel;
  base: SpineModel;
  repo: string | null;
  figs: Figure[];
  arcs: RepoArc[];
  hover: number | null;
  hoverRepo: number | null;
  mode: DevMode;
  introMs: number;
}

/** A number that counts up once per key. Direct DOM writes in one rAF: no React render per frame. */
function CountUp({ to, ms, replay }: { to: number; ms: number; replay: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || ms <= 0) { node.textContent = String(to); return; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      node.textContent = String(Math.round(to * ease.outCubic(u)));
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms, replay]);
  return <span ref={el}>{to}</span>;
}

/** The middle of the dial: the verdict at rest, and whatever ring or repository the pointer is on. */
export function DialHub({ model, base, repo, figs, arcs, hover, hoverRepo, mode, introMs }: HubProps) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const d = p.dial;
  const long = (s: string) => (s.length > 8 ? 'typo-heading-lg' : 'typo-data-lg');

  if (hover != null && figs[hover]) {
    const f = figs[hover];
    const name = stationName(p, f.keys);
    return (
      <div className="dial-hub" key={`r${hover}`} style={{ '--tint': `var(${tintVar(f.keys)})` } as React.CSSProperties}>
        <DialEmblem keys={f.keys} className="dial-hub-art" />
        <p className={`${long(name)} typo-weight-light text-foreground`}>{name}</p>
        <p className="typo-body tabular-nums text-foreground"><b>{f.reachPct}%</b> {d.hub_reached}</p>
        <p className="typo-body tabular-nums text-status-error"><b>{fmtInt(f.exits)}</b> {d.hub_failing}</p>
        <p className="typo-body tabular-nums text-status-warning"><b>{fmtInt(f.stumbled)}</b> {d.hub_stumbled}</p>
      </div>
    );
  }
  const a = hoverRepo != null ? arcs[hoverRepo] : undefined;
  if (a) {
    return (
      <div className="dial-hub" key={`p${hoverRepo}`}>
        <p className={`${long(a.name)} typo-weight-light text-foreground`}>{a.name}</p>
        <p className="typo-body tabular-nums text-foreground"><b>{fmtInt(a.n)}</b> {tx(d.hub_sessions, { mode: mode === 'headless' ? p.mode_headless : p.mode_interactive })}</p>
        <p className="typo-body tabular-nums text-foreground"><b>{pct(a.landed, a.n)}%</b> {p.stat_landed}</p>
        <p className="typo-body tabular-nums text-status-error"><b>{fmtInt(a.errored + a.interrupted)}</b> {d.hub_failing}</p>
      </div>
    );
  }
  const landed = model.outcomes.landed ?? 0;
  const landedPct = pct(landed, model.n);
  return (
    <div className="dial-hub" key="idle">
      <p className="typo-hero typo-weight-light tabular-nums text-foreground"><CountUp to={landedPct} ms={introMs} replay={`${mode}|${repo}`} /><span className="typo-body-lg">%</span></p>
      <p className="typo-heading text-foreground">{p.stat_landed}</p>
      <p className="typo-body tabular-nums text-foreground">
        {repo ? tx(d.hub_count_in, { landed: fmtInt(landed), n: fmtInt(model.n), repo }) : tx(d.hub_count, { landed: fmtInt(landed), n: fmtInt(model.n) })}
      </p>
      {repo && <p className="typo-caption tabular-nums">{tx(p.cohort_share, { pct: `${pct(base.outcomes.landed ?? 0, base.n)}%` })}</p>}
    </div>
  );
}
