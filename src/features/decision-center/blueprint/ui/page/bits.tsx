// Small pieces the feature page's tabs share (bp page/bits.tsx): the page's date, the as-of marker, a field value
// that counts, the health word, the lifecycle ladder, and a metric's sparkline and move arrow.
import { formatPercent } from '@/lib/utils/formatters';
import { useSheet } from '../../controller/SheetContext';
import { stageWord, verdictWord } from '../../controller/useBlueprintText';
import { fval, STAGES, type Feature } from '../../standard/load';
import type { Health, LensField, Scalar } from '../../standard/types';
import { Press } from '../Press';
import { Count } from './motion';
import { stageView } from './readings';
import { dayFmt, fmtValue } from './values';

/** The date the page shows: `past` when the drawing has been travelled back from the data's now (ui.asOf, WP-D2). */
export function useAsOf(): { t: string; now: string; past: boolean } {
  const s = useSheet(), now = s.plan.S.asOf, t = s.ui.asOf ?? now;
  return { t, now, past: t < now };
}

/** The health word of a tile or a lens tab (bp HWORD): the verdict words, "Does not apply" spelled for na. */
export function useHealthWord(): (h: Health) => string {
  const { B } = useSheet().text;
  return (h) => (h === 'na' ? B.pg_na : verdictWord(B, h));
}

/** The marker over a page that shows a past date: what date, what is dated and what is not, and the way back. */
export function AsOfBar() {
  const s = useSheet(), { B, tx, language } = s.text, { t, past } = useAsOf();
  if (!past) return null;
  return (
    <div className="pg-asof" role="status">
      <b>{tx(B.pg_asof, { date: dayFmt(language, t) })}</b>
      <span>{B.pg_asof_note}</span>
      <Press tone="btn" onClick={() => s.dispatch({ type: 'asOf', date: null })}>{B.pg_back_to_now}</Press>
    </div>
  );
}

/** A lens field's value: numbers count (integers, percents, money, ms...), booleans and enums do not. */
export function Val({ k, field, v, unit = '' }: { k: string; field: LensField; v: Scalar | undefined; unit?: string }) {
  const { B, language } = useSheet().text, yn = { yes: B.pg_yes, no: B.pg_no };
  if (typeof v !== 'number') return <>{fmtValue(language, field, v, yn)}{v !== undefined ? unit : ''}</>;
  const whole = Number.isInteger(v);
  return <Count k={k} v={v} fmt={(n) => fmtValue(language, field, whole ? Math.round(n) : n, yn) + unit} />;
}

const num = (v: Scalar | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Where the feature is in its life: the stages in order, the current one marked; build or rollout percent when it has one. */
export function StageLadder({ f }: { f: Feature }) {
  const { B, tx, language } = useSheet().text, { t, now } = useAsOf(), sv = stageView(f, t, now);
  const st = sv.at === 'now' || sv.at === 'then' ? sv.stage : null, isNow = sv.at === 'now';
  const live = f.stage === 'live' || f.stage === 'flagged';
  const pct = !isNow ? null : st === 'in-dev' ? num(fval(f, 'development', 'progressPct')) : st === 'flagged' ? num(fval(f, 'operations', 'rolloutPct')) ?? (live ? 100 : null) : null;
  const steps = STAGES.filter((x) => x !== 'deprecated' || st === 'deprecated'), at = st ? steps.indexOf(st) : -1;
  const name = st ? stageWord(B, st) : sv.at === 'before' ? B.pg_stage_before : B.pg_stage_unknown;
  return (
    <div className="pg-stage" aria-label={isNow ? tx(B.pg_stage_aria, { stage: name }) : tx(B.pg_stage_aria_on, { date: dayFmt(language, t), stage: name })}>
      <ol>{steps.map((x, i) => <li key={x} className={i < at ? 'done' : i === at ? 'cur' : ''}><i />{stageWord(B, x)}</li>)}</ol>
      {pct !== null && (
        <span className="pct">
          <span className="bar"><i style={{ width: Math.max(0, Math.min(100, pct)) + '%' }} /></span>
          <b><Count k={f.id + ':stage%'} v={pct} fmt={(n) => formatPercent(Math.round(n), { language, precision: 0 })} /></b>{st === 'in-dev' ? B.pg_built : B.pg_rolled_out}
        </span>
      )}
      {sv.at === 'then' && (st === 'in-dev' || st === 'flagged') && <span className="pct">{st === 'in-dev' ? B.pg_progress_nr : B.pg_rollout_nr}</span>}
      {sv.at === 'before' && <span className="pct">{tx(B.pg_not_on_drawing, { date: dayFmt(language, t) })}</span>}
      {(sv.at === 'unknown' || (isNow && !st)) && <span className="pct">{B.pg_stage_unknown}</span>}
    </div>
  );
}

const SW = 64, SH = 16;

/**
 * A 64x16 sparkline of a metric's readings, the target as a dashed line when the manifest sets one. Decorative. The
 * floor is pinned at zero (the chart-component golden path: a declared domain, never the sample's own minimum, so a
 * small wobble does not draw as a cliff); bp autoscales to the sample here, the one visual departure, by repo law.
 */
export function Spark({ pts, target, cls }: { pts: readonly number[]; target?: number; cls: string }) {
  let lo = Math.min(...pts, 0), hi = Math.max(...pts);
  if (target !== undefined) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
  const span = hi - lo || 1, x = (i: number) => 1 + (i / (pts.length - 1)) * (SW - 4), y = (v: number) => SH - 2 - ((v - lo) / span) * (SH - 4);
  const d = pts.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  return (
    <svg className={'spk ' + cls} viewBox={`0 0 ${SW} ${SH}`} aria-hidden="true">
      {target !== undefined && <line className="tg" x1={0} x2={SW} y1={y(target)} y2={y(target)} />}
      <path d={d} />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1] ?? 0)} r={1.8} />
    </svg>
  );
}

/** The arrow before a moved metric's value (nothing when it did not move). */
export function MoveArrow({ dir, cls }: { dir: 'up' | 'down' | null; cls: string }) {
  const { B } = useSheet().text;
  return dir ? <i className={'ar ' + cls} role="img" aria-label={cls === 'good' ? B.pg_better : B.pg_worse}>{dir === 'up' ? '▲' : '▼'}</i> : null;
}
