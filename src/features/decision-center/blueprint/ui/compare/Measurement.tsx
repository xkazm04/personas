import type { Comparison } from '@/lib/lensScan/compare';
import type { Measurement as Reading } from '@/lib/lensScan/wire';
import { useSheet } from '../../controller/SheetContext';
import { latestOf } from './MetricLine';

function Line({ label, m }: { label: string; m: Reading }) {
  const { B } = useSheet().text;
  return (
    <>
      <b>{label}</b>
      <span>{m.evidence ?? B.lg_cmp_no_evidence}{m.commit_sha ? <> <code>{m.commit_sha.slice(0, 7)}</code></> : null}</span>
    </>
  );
}

/**
 * What the measurement says (bp Measurement): the item's before and after evidence lines (the latest reading of its
 * own metric in each phase) with the commit each was taken on.
 */
export function Measurement({ c }: { c: Comparison }) {
  const { B } = useSheet().text;
  const p = c.p, b = latestOf(c.before, p.lens, p.metric), a = latestOf(c.after, p.lens, p.metric);
  return (
    <section className="tr-sec" data-testid="blueprint-measure">
      <h4>{B.cmp_measure}</h4>
      <div className="tr-met">
        <div className="evid">
          {b ? <Line label={B.lg_cmp_before} m={b} /> : <><b>{B.lg_cmp_before}</b><span className="dim">{B.lg_cmp_no_reading}</span></>}
          {a ? <Line label={B.lg_cmp_after} m={a} /> : <><b>{B.lg_cmp_after}</b><span className="dim">{p.status === 'failed' ? B.lg_cmp_no_reading_failed : B.lg_cmp_no_reading}</span></>}
        </div>
      </div>
    </section>
  );
}
