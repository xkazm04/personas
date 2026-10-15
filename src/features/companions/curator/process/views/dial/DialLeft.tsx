import { useTranslation } from '@/i18n/useTranslation';
import { DEV_OUTCOMES } from '../../engine/devAdapter';
import type { SpineModel } from '../../engine/spine';
import { outcomeName, pct, stationName } from '../../labels';
import { fmtInt } from './dialFormat';
import type { Figure } from './dialModel';

interface LeftProps {
  model: SpineModel;
  figs: Figure[];
  onOpenStation: (q: number) => void;
  onOutcomeHover: (o: string | null) => void;
  onOpenOutcome: (o: string) => void;
  onHover: (q: number | null) => void;
}

/** The left column: how many walked the whole path, the worst phase as a door, how the sessions ended. */
export function DialLeft({ model, figs, onOpenStation, onOutcomeHover, onOpenOutcome, onHover }: LeftProps) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const d = p.dial;
  const worst = model.worst[0];
  const w = worst != null ? figs[worst] : undefined;
  const rows = DEV_OUTCOMES.map((k) => ({ k, n: model.outcomes[k] ?? 0 })).filter((r) => r.n > 0);

  return (
    <aside className="dial-left dial-arrive" data-dial-chrome aria-label={p.coverage} style={{ '--d': '500ms' } as React.CSSProperties}>
      <div>
        <p className="typo-caption">{p.stat_whole}</p>
        <p className="flex items-baseline gap-2 tabular-nums">
          <span className="typo-hero typo-weight-light text-foreground">{pct(model.walkedAll, model.n)}%</span>
          <span className="typo-caption">{fmtInt(model.walkedAll)} / {fmtInt(model.n)}</span>
        </p>
      </div>

      {w ? (
        <button
          type="button"
          data-tone="bad"
          data-testid="dial-worst"
          aria-label={tx(d.worst_aria, { name: stationName(p, w.keys), exits: w.exits, reached: w.reached })}
          onClick={() => onOpenStation(w.index)}
          onMouseEnter={() => onHover(w.index)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(w.index)}
          onBlur={() => onHover(null)}
        >
          <span className="typo-caption">{p.stat_worst}</span>
          <strong className="typo-heading-lg text-status-error">{stationName(p, w.keys)}</strong>
          <span className="typo-body tabular-nums text-foreground">{tx(d.worst_line, { exits: fmtInt(w.exits), reached: fmtInt(w.reached) })}</span>
          <i aria-hidden="true">&rarr;</i>
        </button>
      ) : (
        <button type="button" disabled>
          <span className="typo-caption">{p.stat_worst}</span>
          <strong className="typo-heading-lg">{d.worst_none}</strong>
          <span className="typo-caption">{p.stat_worst_none}</span>
        </button>
      )}

      <section aria-label={p.outcomes_title} className="dial-outs">
        <h2 className="typo-heading text-foreground">{p.outcomes_title}</h2>
        <ul>
          {rows.map((r) => (
            <li key={r.k}>
              <button
                type="button"
                data-o={r.k}
                onMouseEnter={() => onOutcomeHover(r.k)}
                onMouseLeave={() => onOutcomeHover(null)}
                onFocus={() => onOutcomeHover(r.k)}
                onBlur={() => onOutcomeHover(null)}
                onClick={() => onOpenOutcome(r.k)}
              >
                <i className="dial-od" data-o={r.k} aria-hidden="true" />
                <span className="typo-body text-foreground">{outcomeName(p, r.k)}</span>
                <b className="typo-body tabular-nums text-foreground">{fmtInt(r.n)}<span className="typo-caption">{pct(r.n, model.n)}%</span></b>
                <span className="dial-bar" aria-hidden="true"><i style={{ width: `${Math.max(1.5, (100 * r.n) / Math.max(1, model.n))}%` }} data-o={r.k} /></span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="dial-notes typo-caption">
        <em className="text-foreground">{p.path_note}</em> {p.mode_note} {p.time_note}
      </p>
    </aside>
  );
}
