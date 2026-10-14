import { memo, type KeyboardEvent } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { SpineModel } from '../../engine/spine';
import { stationName } from '../../labels';
import type { Measure } from './geometry';
import type { Scene } from './useScene';
import { fit, pctText, share } from './words';

interface Props {
  scene: Scene;
  model: SpineModel;
  /** The whole mode's spine when a repository is picked: each plate states the mode's share too. */
  base: SpineModel | null;
  measure: Measure;
  arriving: boolean;
  onOpen: (q: number) => void;
  onHover: (q: number | null) => void;
}

/**
 * One plate per settlement, under the map: name, reached share, the red line (ended here failing)
 * and the amber line (stumbled here), at reading size. Text forms are chosen by measurement so a
 * narrow plate says less rather than clipping. Arrow keys walk the plates; Enter opens one.
 */
export const Plates = memo(function Plates({ scene, model, base, measure, arriving, onOpen, onHover }: Props) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const w = p.watershed;
  const { g } = scene;
  const pf = g.fs, U = g.U;

  const onKey = (q: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const j = Math.max(0, Math.min(g.N - 1, q + (e.key === 'ArrowRight' ? 1 : -1)));
    (e.currentTarget.parentElement?.querySelector(`.ws-plate[data-q="${j}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <>
      {model.stations.map((s, q) => {
        const box = g.plates[q]!;
        const rank = g.ranks[q];
        const bs = base?.stations[q];
        const name = stationName(p, s.keys);
        const pct = s.reached ? share(s.reached, g.n) : '–';
        const m = (str: string) => measure(str, pf);
        const inner = box.width - 26 * U - 14 - 16 - measure('100%', pf, 600) - 4;
        const red = [tx(p.left_here, { count: s.exits }), tx(w.marsh_long, { count: s.exits }), tx(w.red_short, { count: s.exits }), tx(w.marsh_short, { count: s.exits })];
        const amb = [tx(p.stumbled, { count: s.friction }), tx(w.amb_mid, { count: s.friction }), tx(w.amb_short, { count: s.friction })];
        const reachRoom = box.width - 26 * U - measure(pct, pf * 1.75, 700) - 14;
        const reachTxt = fit([tx(w.plate_reached, { reached: s.reached, total: g.n }), tx(p.reached, { reached: s.reached, total: g.n }), String(s.reached)], reachRoom, m);
        const at = Math.max(0, Math.min(1, (g.x[q]! + 20 - g.xA + g.srcW) / (g.W + g.srcW)));
        const aria = [
          tx(w.plate_aria, { name, pct: pctText(s.reached, g.n), reached: s.reached, total: g.n }),
          tx(p.left_here, { count: s.exits }) + '.',
          tx(p.stumbled, { count: s.friction }) + '.',
          rank ? tx(p.rank, { rank }) + '.' : '',
          w.plate_open,
        ].filter(Boolean).join(' ');
        return (
          <Button
            key={q}
            variant="ghost"
            data-q={q}
            className={`ws-plate${rank === 1 ? ' is-hot' : ''}${arriving ? ' is-arriving' : ''}`}
            style={{ left: box.left, top: box.top, width: box.width, height: g.plateH, ['--at' as string]: 1 - Math.pow(1 - at, 1 / 2.2) }}
            aria-label={aria}
            onClick={() => onOpen(q)}
            onPointerEnter={() => onHover(q)}
            onPointerLeave={() => onHover(null)}
            onFocus={() => onHover(q)}
            onBlur={() => onHover(null)}
            onKeyDown={onKey(q)}
            data-testid={`watershed-plate-${q}`}
          >
            {rank ? <span className="ws-p-pill">{tx(p.rank, { rank })}</span> : null}
            <span className="ws-p-name">{name}</span>
            <span className="ws-p-reach"><span className="ws-p-big">{pct}</span><span className="ws-p-k">{reachTxt}</span></span>
            {bs && base ? <span className="ws-p-cmp">{tx(p.cohort_share, { pct: pctText(bs.reached, base.n) })}</span> : null}
            {!s.reached ? (
              <span className="ws-p-line is-none"><i className="ws-g-none" /><span className="t">{w.nobody}</span><b>–</b></span>
            ) : !s.exits && !s.friction ? (
              <span className="ws-p-line is-none"><i className="ws-g-none" /><span className="t">{p.no_failures}</span><b /></span>
            ) : (
              <>
                <span className="ws-p-line is-red"><i className="ws-g-marsh" /><span className="t">{fit(red, inner, m)}</span><b>{pctText(s.exits, s.reached)}</b></span>
                <span className="ws-p-line is-amb"><i className="ws-g-rapid" /><span className="t">{fit(amb, inner, m)}</span><b>{pctText(s.friction, s.reached)}</b></span>
              </>
            )}
          </Button>
        );
      })}
    </>
  );
});
