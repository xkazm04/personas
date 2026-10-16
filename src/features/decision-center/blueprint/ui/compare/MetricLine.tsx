import type { Comparison, Verdict } from '@/lib/lensScan/compare';
import type { Measurement } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import type { BpText } from '../../controller/useBlueprintText';
import { VerdictChip as Chip } from '../../ledger/Marks';
import { fmtNum, unitFor } from '../format';

const VERDICT_KEY = { moved: 'cmp_v_moved', flat: 'cmp_v_flat', worse: 'cmp_v_worse', unmeasured: 'cmp_v_unmeasured' } as const satisfies Record<Verdict, keyof BpText>;
const VERDICT_TONE: Record<Verdict, string> = { moved: 'ok', flat: 'wait', worse: 'fail', unmeasured: 'no' };

/** The L4 sheet's verdict chip (its pack rows): compare.ts's verdict in the tone the state table uses. */
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
 * The metric line (bp MetricStrip): the item's metric `before -> after unit` in big figures, the metric key with the
 * verdict (a failed build says so), and how to read it: the better direction, the target and the method. The readings
 * are the item's own phased ones; an absent before reads "–", an absent after "?", never zero.
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
    tx(B.cmp_method, { method: method ?? '–' }) + (method === 'judgement' ? ' ' + B.lg_cmp_judgement : ''),
  ].filter((x): x is string => x !== null).join(' · ');
  return (
    <section className="tr-sec">
      <h4>{B.cmp_metric}</h4>
      <div className="tr-met" data-testid="blueprint-metric">
        <div className="big">
          <s>{b ? fmtNum(language, b.value) : '–'}</s><span className="ar" aria-hidden="true">→</span>
          <span>{a ? fmtNum(language, a.value) : '?'}</span>{unit ? <u>{unitFor(unit, a?.value ?? b?.value)}</u> : null}
        </div>
        <div className="k">
          {p.metric ?? B.cmp_no_metric} <Chip verdict={c.verdict} failed={p.status === 'failed'} />
          <small>{how}</small>
        </div>
      </div>
    </section>
  );
}
