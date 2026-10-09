// A doc's status in words and in marks: its label, the one line of why (the
// broken references, or the changed sources it has not caught up with), the
// short count the estate's peek shows, its pill and its estate swatch.
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';

import { useLifecycleViewModel } from '../../context';
import { Pill } from '../../system/Pill';
import { asDocStatus, type DocStatus } from '../docsModel';
import { DOC_LOOK } from './docLooks';

export function useDocStatusLabel() {
  const { dl } = useLifecycleViewModel();
  return (s: DocStatus): string => ({
    broken: dl.lc2_doc_broken, stale: dl.lc2_doc_stale, unverifiable: dl.lc2_doc_unverifiable, clean: dl.lc2_doc_clean,
  })[s];
}

/** The row's one line of why: the first three paths, then "and N more". */
export function useDocWhy() {
  const { dl, tx } = useLifecycleViewModel();
  return (row: LifecycleDocRow): string => {
    const list = (xs: string[]) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? tx(dl.lc2_and_more, { count: xs.length - 3 }) : '');
    switch (asDocStatus(row.status)) {
      case 'broken': return row.brokenRefs.length === 1
        ? tx(dl.lc2_doc_why_broken_one, { refs: list(row.brokenRefs) })
        : tx(dl.lc2_doc_why_broken, { count: row.brokenRefs.length, refs: list(row.brokenRefs) });
      case 'stale': return row.changedSources.length === 1
        ? tx(dl.lc2_doc_why_stale_one, { sources: list(row.changedSources) })
        : tx(dl.lc2_doc_why_stale, { count: row.changedSources.length, sources: list(row.changedSources) });
      case 'unverifiable': return dl.lc2_doc_why_unverifiable;
      case 'clean': return dl.lc2_doc_why_clean;
    }
  };
}

/** The peek's short why: a count, or the one-line verdict when there is nothing to count. */
export function useDocCount() {
  const { dl, tx } = useLifecycleViewModel();
  return (row: LifecycleDocRow): string => {
    switch (asDocStatus(row.status)) {
      case 'broken': return tx(dl.lcx7_peek_broken, { count: row.brokenRefs.length });
      case 'stale': return tx(dl.lcx7_peek_stale, { count: row.changedSources.length });
      case 'unverifiable': return dl.lc2_doc_why_unverifiable;
      case 'clean': return dl.lc2_doc_why_clean;
    }
  };
}

export function DocPill({ status }: { status: DocStatus }) {
  const label = useDocStatusLabel();
  return <Pill look={DOC_LOOK[status]} label={label(status)} data={{ 'data-doc-status': status }} />;
}

/** The estate cell's shape at a chip's size: the legend IS the figure's vocabulary. */
export function DocSwatch({ status }: { status: DocStatus }) {
  return <span aria-hidden className="lcx7-cell lcx7-swatch" data-status={status} />;
}
