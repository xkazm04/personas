import type { Comparison } from '@/lib/lensScan/compare';
import { DeferredMarkdown } from '@/features/shared/components/editors/DeferredMarkdown';
import { useSheet } from '../../controller/SheetContext';
import type { WorkItem } from '../../model/work';
import { PackEvidence } from '../sheet/PackEvidence';
import { CommitDiff } from './CommitDiff';
import { MetricLine } from './MetricLine';
import { hasRuns, PerfTable } from './PerfTable';
import { Screens } from './Screens';

/**
 * The compare panel's body (bp ComparePanel Body), top to bottom: the metric line, or for an item measured in baseline
 * runs the performance table; a failed build's notice; the screens; what the measurement says (the item's before and
 * after evidence lines, WP4a's table); the commit and its diff, fetched when the item is shown; the item's own text.
 * The panel keys it by item, so a theme or mode choice resets when the item changes.
 */
export function CompareBody({ c, p }: { c: Comparison; p: WorkItem }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const row = c.p;
  const runs = hasRuns(c);
  return (
    <div className="bp-cmp-b">
      {runs ? <PerfTable c={c} /> : <MetricLine c={c} />}
      {row.status === 'failed' ? <p className="bp-cmp-call bp-tone-fail typo-body" role="note"><b>{B.cmp_failed_title}</b> {B.cmp_failed}</p> : null}
      <Screens c={c} />
      <section className="bp-cmp-sec">
        <h4 className="typo-eyebrow bp-eyebrow">{B.cmp_measure}</h4>
        <PackEvidence p={p} />
      </section>
      {row.commit_sha ? <CommitDiff sha={row.commit_sha} /> : (
        <section className="bp-cmp-sec">
          <h4 className="typo-eyebrow bp-eyebrow">{B.cmp_commit_head}</h4>
          <p className="bp-empty typo-body">{row.status === 'failed' ? B.cmp_commit_none_failed : B.cmp_commit_none}</p>
        </section>
      )}
      <section className="bp-cmp-sec">
        <h4 className="typo-eyebrow bp-eyebrow">{tx(B.cmp_item, { standard: row.standard })}</h4>
        <div className="bp-cmp-md"><DeferredMarkdown content={row.body ?? row.title} variant="card" /></div>
      </section>
    </div>
  );
}
