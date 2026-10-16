import type { Comparison, Verdict } from '@/lib/lensScan/compare';
import type { Measurement } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import type { BpText } from '../../controller/useBlueprintText';
import { fmtNum, unitFor } from '../format';

const VERDICT_KEY = { moved: 'cmp_v_moved', flat: 'cmp_v_flat', worse: 'cmp_v_worse', unmeasured: 'cmp_v_unmeasured' } as const satisfies Record<Verdict, keyof BpText>;
const VERDICT_TONE: Record<Verdict, string> = { moved: 'ok', flat: 'wait', worse: 'fail', unmeasured: 'no' };

/** compare.ts's verdict as a chip: better, within noise, worse or not measured, in the tone the state table uses. */
export function VerdictChip({ B, verdict }: { B: BpText; verdict: Verdict }) {
  return <span className={`bp-chip typo-label bp-tone-${VERDICT_TONE[verdict]}`} data-verdict={verdict} data-testid="blueprint-verdict">{B[VERDICT_KEY[verdict]]}</span>;
}

/** The latest reading of the item's own lens and metric in a phase's rows (they come sorted, oldest first). */
export function latestOf(rows: readonly Measurement[], lens: string, metric: string | undefined): Measurement | undefined {
  let r: Measurement | undefined;
  for (const m of rows) if (m.lens === lens && m.metric === metric) r = m;
  return r;
}

/**
 * The metric line (bp MetricStrip): the item's metric `before -> after unit` in large figures, the metric's name with
 * compare.ts's verdict, and how to read it: the better direction, the target and the method, from the lens manifest.
 * The readings are the item's own phased ones; an absent side reads as a dash, never as zero.
 */
export function MetricLine({ c }: { c: Comparison }) {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const p = c.p, b = latestOf(c.before, p.lens, p.metric), a = latestOf(c.after, p.lens, p.metric);
  const field = p.metric ? s.plan.LENS[p.lens]?.F[p.metric] : undefined;
  const unit = b?.unit ?? a?.unit ?? field?.unit ?? '';
  const better = field?.metric?.better ?? (p.expected_delta ? (p.expected_delta > 0 ? 'up' : 'down') : undefined);
  const method = a?.method ?? b?.method ?? field?.metric?.method;
  const how = [
    better ? (better === 'down' ? B.cmp_lower_better : B.cmp_higher_better) : null,
    field?.metric?.target !== undefined ? tx(B.cmp_target, { value: fmtNum(language, field.metric.target) }) : null,
    method ? tx(B.cmp_method, { method }) : null,
  ].filter((x): x is string => x !== null).join(' · ');
  return (
    <section className="bp-cmp-sec">
      <h4 className="typo-eyebrow bp-eyebrow">{B.cmp_metric}</h4>
      <div className="bp-met" data-testid="blueprint-metric">
        <div className="bp-met-big typo-data">
          <s>{b ? fmtNum(language, b.value) : '–'}</s>
          <span aria-hidden="true">{'→'}</span>
          <b>{a ? fmtNum(language, a.value) : '–'}</b>
          {unit ? <span className="bp-u typo-code">{unitFor(unit, a?.value ?? b?.value)}</span> : null}
        </div>
        <div className="bp-met-k typo-body">
          <span><span className="typo-code">{field?.label ?? p.metric ?? B.cmp_no_metric}</span> <VerdictChip B={B} verdict={c.verdict} /></span>
          {how ? <span className="bp-ink">{how}</span> : null}
        </div>
      </div>
    </section>
  );
}
