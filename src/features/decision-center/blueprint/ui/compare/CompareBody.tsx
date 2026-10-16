import { memo } from 'react';
import type { Comparison } from '@/lib/lensScan/compare';
import { DeferredMarkdown } from '@/features/shared/components/editors/DeferredMarkdown';
import { useSheet } from '../../controller/SheetContext';
import { Callout } from '../../ledger/Controls';
import type { CompareView } from '../../ledger/ledgerStore';
import { CommitDiff } from './CommitDiff';
import { Measurement } from './Measurement';
import { MetricLine } from './MetricLine';
import { hasRuns, PerfTable } from './PerfTable';
import { Screens } from './Screens';

export interface CompareBodyProps {
  c: Comparison;
  fname: string;
  view: CompareView;
  onView(v: CompareView): void;
  /** The panel takes the page's width: the patch opens at once (bp shows everything wide). */
  wide: boolean;
}

/** The first sentence of the item's Summary (else its title): the state it designs, for the screens' callout. */
export function stateLine(body: string | undefined, title: string): string {
  const m = /##\s*Summary\s*\n+([\s\S]*?)(?:\n##\s|$)/.exec(body ?? '');
  const s = (m?.[1] ?? title).trim().split(/(?<=\.)\s/)[0] ?? title;
  return s.replace(/\.$/, '');
}

/**
 * The compare panel's body (bp ComparePanel Body), top to bottom: the metric line, or for an item measured in
 * baseline runs the performance table; a failed build's flag; the screens (light / dark / both x side by side / slider
 * / blink / change map); what the measurement says; the commit and its diff; the item's own text under its standard.
 */
export const CompareBody = memo(function CompareBody({ c, fname, view, onView, wide }: CompareBodyProps) {
  const { B, tx } = useSheet().text;
  const row = c.p, runs = hasRuns(c);
  return (
    <div className="tr-cmp-b">
      {runs ? <PerfTable c={c} /> : <MetricLine c={c} />}
      {row.status === 'failed' ? <div className="tr-sec"><Callout tone="flag"><b>✕ {B.cmp_failed_title}</b><span>{B.cmp_failed}</span></Callout></div> : null}
      {!runs || c.shots.length ? <Screens c={c} view={view} onView={onView} fname={fname} stateLine={stateLine(row.body, row.title)} /> : null}
      <Measurement c={c} />
      {row.commit_sha ? <CommitDiff sha={row.commit_sha} initiallyOpen={wide} /> : (
        <section className="tr-sec"><h4>{B.cmp_commit_head}</h4><p className="tr-dim">{row.status === 'failed' ? B.cmp_commit_none_failed : B.cmp_commit_none}</p></section>
      )}
      <section className="tr-sec">
        <h4>{tx(B.cmp_item, { standard: row.standard })}</h4>
        <div className="tr-md"><DeferredMarkdown content={row.body ?? row.title} variant="card" /></div>
      </section>
    </div>
  );
});
