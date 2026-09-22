// One line of the books.
//
// Rank, name, what it declared, what has been observed, the composition bar,
// the three debts as numbers, and ONE sentence saying what to do about it. The
// sentence is not decoration: a row of six numbers tells a reader what is true
// and nothing about what is theirs to do.
import { useTranslation } from '@/i18n/useTranslation';

import { CoverageBar, SizeBar } from '../../estate/CoverageBar';
import { nextMoveOf, nextMoveText } from '../../estate/kpiNextMove';
import type { BookRow as Row } from './kpiBooks';
import { RelativeReading } from './RelativeReading';

export function BookRowLine({
  row,
  largest,
  focused,
  onFocus,
  onOpen,
}: {
  row: Row;
  largest: number;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const coveragePct = Math.round(row.tally.coverage * 100);

  return (
    <tr
      className={`border-b border-card-border transition-colors ${focused ? 'bg-secondary/30' : 'hover:bg-secondary/15'}`}
      onMouseEnter={onFocus}
      onFocus={onFocus}
      data-testid={`kpi-books-row-${row.id}`}
    >
      <td className="py-2 pl-2 pr-1 align-top typo-code text-foreground tabular-nums">{row.rank}</td>

      <td className="w-[34%] max-w-0 py-2 pr-3 align-top">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-interactive text-left focus-ring"
        >
          <span className="block truncate typo-title text-foreground">{row.label}</span>
          {row.context && <span className="block truncate typo-caption text-foreground">{row.context}</span>}
          <span className="mt-0.5 block typo-caption text-foreground">
            {nextMoveText(nextMoveOf(row.tally), t, tx)}
          </span>
        </button>
      </td>

      <td className="py-2 pr-3 align-top text-right typo-data text-foreground tabular-nums">{row.tally.total}</td>

      <td className="py-2 pr-3 align-top text-right">
        <span className="block typo-data text-foreground tabular-nums">{row.tally.measured}</span>
        <span className="block typo-caption text-foreground tabular-nums">{`${coveragePct}%`}</span>
      </td>

      <td className="w-[18%] min-w-[7rem] py-2 pr-3 align-top">
        <CoverageBar tally={row.tally} />
        <span className="mt-1 block">
          <SizeBar total={row.tally.total} max={largest} />
        </span>
      </td>

      <Debt value={row.debts.reading} label={o.debt_reading} />
      <Debt value={row.debts.verdict} label={o.debt_verdict} />
      <Debt value={row.debts.refresh} label={o.debt_refresh} />

      <td className="py-2 pr-2 align-top text-right typo-caption text-foreground">
        <RelativeReading at={row.lastReadAt} />
      </td>
    </tr>
  );
}

function Debt({ value, label }: { value: number; label: string }) {
  return (
    <td className="py-2 pr-3 align-top text-right">
      <span
        className="block typo-data tabular-nums"
        style={{ color: value > 0 ? 'var(--foreground)' : 'var(--muted-foreground)' }}
      >
        {value}
      </span>
      <span className="block typo-caption text-foreground">{label}</span>
    </td>
  );
}
