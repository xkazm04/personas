import { useMemo } from 'react';
import { FRAME_MS, type Comparison } from '@/lib/lensScan/compare';
import { useSheet } from '../../controller/SheetContext';
import type { BpText } from '../../controller/useBlueprintText';
import { atTarget, perfFigures, shortUnit, type PerfFigures } from '../../model/perf';
import { comparisonOf } from '../../model/triage';
import type { LensField } from '../../standard/types';
import { fmtNum, signed } from '../format';
import { latestOf, VerdictChip } from './MetricLine';
import { PerfRange } from './PerfRange';

interface Context { key: string; label: string; unit: string; value: number; target?: number; better: 'up' | 'down' }
interface PerfItem { c: Comparison; fname: string; label: string; unit: string; f: PerfFigures; field?: LensField; context: Context[] }

/** The item's own-metric baseline runs (its `before` readings of its lens and metric, oldest first). */
export const runsOf = (c: Comparison): number[] => c.before.filter((m) => m.lens === c.p.lens && m.metric === c.p.metric).map((m) => m.value);
/** An item is shown in the performance table when it was measured in two or more baseline runs. */
export const hasRuns = (c: Comparison): boolean => runsOf(c).length > 1;

function perfItem(c: Comparison, fname: string, F: Readonly<Record<string, LensField>> | undefined): PerfItem {
  const p = c.p, b = latestOf(c.before, p.lens, p.metric), a = latestOf(c.after, p.lens, p.metric);
  const field = p.metric ? F?.[p.metric] : undefined, unit = b?.unit ?? field?.unit ?? '';
  const seen = new Map<string, Context>();
  for (const m of c.before) {
    if (m.lens !== p.lens || m.metric === p.metric) continue;
    const fd = F?.[m.metric];
    seen.set(m.metric, { key: m.metric, label: fd?.label ?? m.metric, unit: m.unit ?? fd?.unit ?? '', value: m.value, better: fd?.metric?.better ?? 'down', ...(fd?.metric?.target !== undefined ? { target: fd.metric.target } : {}) });
  }
  return { c, fname, label: field?.label ?? p.metric ?? '', unit, f: perfFigures(runsOf(c), a?.value, unit), field, context: [...seen.values()] };
}

/** Why the verdict is what it is, in one sentence over the item's figures (bp perfReason). */
function why(B: BpText, tx: ReturnType<typeof useSheet>['text']['tx'], language: string, it: PerfItem): string {
  const { f, unit } = it, u = unit ? ' ' + shortUnit(unit) : '';
  if (f.change === undefined) return B.cmp_pt_why_none;
  const args = { change: signed(language, f.change) + u, runs: f.runs.length, noise: fmtNum(language, f.noise) + u };
  if (Math.abs(f.change) <= f.noise) return tx(B.cmp_pt_why_flat, args);
  return tx(it.c.verdict === 'worse' ? B.cmp_pt_why_worse : B.cmp_pt_why_moved, args);
}

function Rows({ it }: { it: PerfItem }) {
  const s = useSheet();
  const { B, language } = s.text;
  const n = (v: number) => fmtNum(language, v);
  const pct = (v: number) => new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }).format(v / 100);
  const { f, unit, field } = it, better = field?.metric?.better ?? 'down', target = field?.metric?.target, u = shortUnit(unit);
  const tone = f.change === undefined || f.change === 0 ? '' : (f.change < 0) === (better === 'down') ? ' bp-good' : ' bp-bad';
  const cmp = better === 'up' ? '≥ ' : '≤ ';
  return (
    <>
      <tr className="bp-pt-name">
        <th scope="colgroup" colSpan={6}><b>{it.fname}</b> <span>{it.label}{u ? ` · ${u}` : ''}</span> <VerdictChip B={B} verdict={it.c.verdict} /></th>
      </tr>
      <tr className="bp-pt-main">
        <td className="bp-pt-runs">{f.runs.map((x, i) => <span key={i} className={f.outlier[i] ? 'bp-out' : undefined}>{n(x)}{f.outlier[i] ? <span className="sr-only"> {B.cmp_pt_outlier}</span> : null}</span>)}</td>
        <td>{n(f.median)}</td>
        <td className="bp-pt-aft">{f.after !== undefined ? n(f.after) : '–'}</td>
        <td className={'bp-pt-chg' + tone}>{f.change !== undefined ? <>{signed(language, f.change)}{f.pct !== undefined ? <small>{pct(f.pct)}</small> : null}</> : '–'}</td>
        <td>{n(f.noise)}<small>{f.frame ? B.cmp_pt_frame : B.cmp_pt_spread}</small></td>
        <td>{target !== undefined ? cmp + n(target) : '–'}</td>
      </tr>
      <tr className="bp-pt-strip"><td colSpan={6}><PerfRange f={f} unit={u} target={target} warn={field?.metric?.warn_at} /></td></tr>
      {it.context.map((o) => {
        const ok = o.target === undefined ? undefined : atTarget(o.value, o.target, o.better);
        return (
          <tr key={o.key} className="bp-pt-ctx">
            <th scope="row"><span>{o.label}{o.unit ? ` · ${shortUnit(o.unit)}` : ''}</span><small>{B.cmp_pt_not_rerun}</small></th>
            <td>{n(o.value)}</td><td>–</td><td>–</td><td>–</td>
            <td>{ok === undefined ? '–' : <><span className={ok ? 'bp-good' : 'bp-bad'}>{ok ? B.cmp_pt_at_target : B.cmp_pt_over_target}</span> {(o.better === 'up' ? '≥ ' : '≤ ') + n(o.target ?? 0)}</>}</td>
          </tr>
        );
      })}
    </>
  );
}

function Table({ items }: { items: readonly PerfItem[] }) {
  const { B } = useSheet().text;
  return (
    <div className="bp-pt-wrap">
      <table className="bp-pt typo-body">
        <thead><tr><th scope="col">{B.cmp_pt_runs}</th><th scope="col">{B.cmp_pt_median}</th><th scope="col">{B.cmp_pt_after}</th><th scope="col">{B.cmp_pt_change}</th><th scope="col">{B.cmp_pt_noise}</th><th scope="col">{B.cmp_pt_target}</th></tr></thead>
        <tbody>{items.map((it) => <Rows key={it.c.p.id} it={it} />)}</tbody>
      </table>
    </div>
  );
}

/**
 * The performance table (bp PerfTable), for an item measured in baseline runs: each run (an outlier outlined), their
 * median, the after, the change and its percentage, the noise a change must beat (compare.ts runStats: the spread, at
 * least one frame for a timing), the target, and the range strip; then the feature's other metrics of the lens from
 * their base reading. Below it, the rest of the pack measured in runs. Metrics and targets come from the lens manifest.
 */
export function PerfTable({ c }: { c: Comparison }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const F = s.plan.LENS[c.p.lens]?.F;
  const me = useMemo(() => perfItem(c, s.plan.L.TILE[c.p.feature]?.f.name ?? c.p.feature, F), [c, s.plan, F]);
  const mates = useMemo(() => {
    const ids = c.p.pack_id ? s.work.items.filter((x) => x.pack === c.p.pack_id && x.id !== c.p.id).map((x) => x.id) : [];
    return ids.map((id) => comparisonOf(s.data.scan, s.plan, id)).filter((x): x is Comparison => !!x && hasRuns(x))
      .map((x) => perfItem(x, s.plan.L.TILE[x.p.feature]?.f.name ?? x.p.feature, F));
  }, [c.p, s.work, s.data.scan, s.plan, F]);
  return (
    <>
      <section className="bp-cmp-sec" data-testid="blueprint-perf">
        <h4 className="typo-eyebrow bp-eyebrow">{tx(B.cmp_perf, { metric: me.label })}</h4>
        <Table items={[me]} />
        <div className="bp-pt-key typo-code"><span><i className="bp-k-run" />{B.cmp_pt_key_run}</span><span><i className="bp-k-aft" />{B.cmp_pt_after}</span><span><i className="bp-k-band" />{tx(B.cmp_pt_key_band, { ms: fmtNum(language, FRAME_MS) })}</span><span><i className="bp-k-t" />{B.cmp_pt_target}</span></div>
        <p className="bp-ink typo-body">{why(B, tx, language, me)}</p>
      </section>
      {mates.length ? <section className="bp-cmp-sec"><h4 className="typo-eyebrow bp-eyebrow">{B.cmp_pt_pack}</h4><Table items={[me, ...mates]} /></section> : null}
    </>
  );
}
