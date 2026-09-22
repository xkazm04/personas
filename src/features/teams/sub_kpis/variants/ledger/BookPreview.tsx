// What is below a row, before you commit to going there - as a tooltip on
// the row's title.
//
// It was a fixed side pane. The pane held its own height, took a fifth of the
// page from the table, and read as an empty panel until a row was hovered.
// Anchored to the title it names, it appears only when there is something to
// say and gives the table the full width. It is still the page the reader is
// about to get, not a summary of it: the balance, the move, and the first
// rows inside. Inert, like every tooltip - the row is the click target.
import { useTranslation } from '@/i18n/useTranslation';

import { CoverageBar } from '../../estate/CoverageBar';
import { nextMoveOf, nextMoveText } from '../../estate/kpiNextMove';
import { KT } from '../../estate/kpiType';
import type { BookRow } from './kpiBooks';

export function BookPreviewTip({ row, below }: { row: BookRow; below: BookRow[] }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  return (
    <span className="block w-[20rem] space-y-2 py-0.5">
      <span className={`block ${KT.name}`}>{row.label}</span>
      <CoverageBar tally={row.tally} height={6} />
      <span className={`block ${KT.figure}`}>
        {tx(o.preview_balance, { total: row.tally.total, measured: row.tally.measured, owed: row.debts.reading })}
      </span>
      <span className={`block ${KT.meta}`}>{nextMoveText(nextMoveOf(row.tally), t, tx)}</span>

      {below.length > 0 && (
        <span className="block border-t border-primary/10 pt-1.5">
          <span className={`mb-1 block ${KT.eyebrow}`}>{o.preview_below}</span>
          {below.map((child) => (
            <span key={child.id} className="flex items-baseline gap-2">
              <span className={`w-4 shrink-0 ${KT.metaFigure}`}>{child.rank}</span>
              <span className={`min-w-0 flex-1 truncate ${KT.text}`}>{child.label}</span>
              <span className={`shrink-0 ${KT.metaFigure}`}>{`${child.tally.measured}/${child.tally.total}`}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
