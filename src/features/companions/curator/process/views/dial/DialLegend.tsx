import { useTranslation } from '@/i18n/useTranslation';
import { stationName } from '../../labels';
import { fmtDur, fmtInt } from './dialFormat';
import type { Figure, Ring } from './dialModel';
import { tintVar } from './dialPalette';

interface LegendProps {
  figs: Figure[];
  rings: Ring[];
  hover: number | null;
  /** changes when the rows should arrive again */
  arrive: string;
  onOpenStation: (q: number) => void;
  onHover: (q: number | null) => void;
}

const CHIP = ['var(--color-accent)', 'var(--color-status-neutral)', 'var(--color-status-error)', 'var(--color-status-warning)'];

/** The ring as a 30px donut: the same four cuts, read at a glance beside its name. */
function Chip({ ring }: { ring: Ring }) {
  const r = 10.5;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg className="dial-chip" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <circle cx="15" cy="15" r={r} fill="none" stroke="currentColor" strokeOpacity=".14" strokeWidth="5" />
      {ring.t.map((n, i) => {
        if (!n) return null;
        const len = (c * n) / 120;
        const at = off;
        off += len;
        return <circle key={i} cx="15" cy="15" r={r} fill="none" stroke={CHIP[i]} strokeWidth="5" strokeDasharray={`${len.toFixed(2)} ${(c - len).toFixed(2)}`} strokeDashoffset={(-at).toFixed(2)} transform="rotate(-90 15 15)" />;
      })}
    </svg>
  );
}

/** The right column: one door per phase, in plain figures. Hovering one lights its ring. */
export function DialLegend({ figs, rings, hover, arrive, onOpenStation, onHover }: LegendProps) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const d = p.dial;
  return (
    <ol className="dial-legend" data-dial-chrome key={arrive} aria-label={p.coverage}>
      {figs.map((f, q) => {
        const name = stationName(p, f.keys);
        const ring = rings[q]!;
        const wait = Number.isFinite(f.medWait) ? tx(p.wait, { value: fmtDur(f.medWait) }) : q === 0 ? d.row_every : d.row_no_wait;
        return (
          <li key={f.keys.join('|')} style={{ '--i': q, '--tint': `var(${tintVar(f.keys)})` } as React.CSSProperties}>
            <button
              type="button"
              data-hot={f.rank === 1 ? '' : undefined}
              data-active={hover === q ? '' : undefined}
              data-testid={`dial-row-${q}`}
              aria-label={tx(d.row_aria, { name, reach: `${f.reachPct}%`, exits: f.exits, stumbled: f.stumbled })}
              onClick={() => onOpenStation(q)}
              onMouseEnter={() => onHover(q)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(q)}
              onBlur={() => onHover(null)}
            >
              <span className="dial-row-name typo-heading-lg">
                <Chip ring={ring} />
                {name}
                {f.rank > 0 && <span className="dial-rank typo-caption">{tx(p.rank, { rank: f.rank })}</span>}
              </span>
              {f.reached === 0 ? (
                <>
                  <span className="dial-absent typo-body">
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.6" aria-hidden="true"><circle cx="9" cy="9" r="7" /></svg>
                    {tx(d.row_absent, { total: fmtInt(f.n) })}
                  </span>
                  {f.vs && <span className="typo-caption tabular-nums">{tx(p.cohort_share, { pct: `${f.vs.reachPct}%` })}</span>}
                </>
              ) : (
                <>
                  <span className="typo-body tabular-nums text-foreground">
                    <b className="typo-heading">{f.reachPct}%</b> {d.row_reached} · {tx(p.reached, { reached: fmtInt(f.reached), total: fmtInt(f.n) })}
                    {f.vs && <> · {tx(d.row_all, { pct: `${f.vs.reachPct}%` })}</>}
                  </span>
                  <span className="dial-two typo-body tabular-nums text-foreground">
                    <span><i className="dial-od" data-o="errored" aria-hidden="true" /><b>{fmtInt(f.exits)}</b> {d.row_failing}</span>
                    <span><i className="dial-od" data-o="interrupted" aria-hidden="true" /><b>{fmtInt(f.stumbled)}</b> {d.row_stumbled}</span>
                  </span>
                  {f.vs && f.vs.exitPct != null && f.exitPct != null && (
                    <span className="typo-caption tabular-nums">{tx(d.row_cmp_fail, { pct: `${f.exitPct}%`, all: `${f.vs.exitPct}%` })}</span>
                  )}
                  <span className="typo-caption tabular-nums">{wait}</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
