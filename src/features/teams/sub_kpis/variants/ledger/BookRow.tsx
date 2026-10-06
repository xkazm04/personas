// One line of the books.
//
// Rank, name, what it declared, what has been observed, the composition bar,
// and the three debts as bare numbers under the column heads that name them.
// The row says WHAT is true; what to do about it, and what is inside, live in
// the tooltip on the name (`BookPreviewTip`), so every row is one line tall and
// the table reads as a table.
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { CoverageBar, SizeBar } from '../../estate/CoverageBar';
import { useKT } from '../../treatment/KpiTreatmentContext';
import type { BookRow as Row } from './kpiBooks';
import { BookPreviewTip } from './BookPreview';
import { RelativeReading } from './RelativeReading';

export function BookRowLine({
  row,
  below,
  largest,
  onOpen,
}: {
  row: Row;
  /** The first rows one level down, for the preview tooltip. */
  below: Row[];
  largest: number;
  onOpen: () => void;
}) {
  const KT = useKT();
  const coveragePct = Math.round(row.tally.coverage * 100);

  return (
    <tr className={`border-b transition-colors ${KT.rule} ${KT.rowHover}`} data-testid={`kpi-books-row-${row.id}`}>
      <td className={`pl-2 pr-1 align-middle ${KT.rowPad} ${KT.metaFigure}`}>{row.rank}</td>

      <td className={`w-[34%] max-w-0 pr-3 align-middle ${KT.rowPad}`}>
        <Tooltip placement="right" content={<BookPreviewTip row={row} below={below} />}>
          <button type="button" onClick={onOpen} className="block w-full rounded-interactive text-left focus-ring">
            <span className={`block truncate ${KT.name}`}>{row.label}</span>
            {row.context && <span className={`block truncate ${KT.meta}`}>{row.context}</span>}
          </button>
        </Tooltip>
      </td>

      <td className={`pr-3 align-middle text-right ${KT.rowPad} ${KT.figure}`}>{row.tally.total}</td>

      <td className={`pr-3 align-middle text-right ${KT.rowPad}`}>
        <span className={KT.figure}>{row.tally.measured}</span>{' '}
        <span className={KT.metaFigure}>{`${coveragePct}%`}</span>
      </td>

      <td className={`w-[18%] min-w-[7rem] pr-3 align-middle ${KT.rowPad}`}>
        <CoverageBar tally={row.tally} />
        <span className="mt-1 block">
          <SizeBar total={row.tally.total} max={largest} />
        </span>
      </td>

      <Debt value={row.debts.reading} />
      <Debt value={row.debts.verdict} />
      <Debt value={row.debts.refresh} />

      <td className={`pr-2 align-middle text-right ${KT.rowPad} ${KT.text}`}>
        <RelativeReading at={row.lastReadAt} />
      </td>
    </tr>
  );
}

/** A debt is a bare figure: the column head already names it. A zero is
 *  muted, so the eye lands on the columns that owe something. */
function Debt({ value }: { value: number }) {
  const KT = useKT();
  return (
    <td className={`pr-3 align-middle text-right ${KT.rowPad}`}>
      <span className={value > 0 ? KT.figure : KT.metaFigure}>{value}</span>
    </td>
  );
}
