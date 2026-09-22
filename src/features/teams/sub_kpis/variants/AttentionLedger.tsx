// THE LEDGER - "the books".
//
// Winner of the kpi-descent contest's Ledger seat (2026-09-21) and top of both
// scoreboards, rebuilt here in the app's own idiom. The bet: A PORTFOLIO IS A
// SET OF BOOKS. `declared = observed + reading owed`, and every row balances in
// print, so the 900 KPIs nobody has read stop being a grey blank and become a
// liability somebody has to answer for.
//
// What it replaced was eleven stacked project sections of small text - a
// scroll, not an overview. This is one page: the estate's own line at the top,
// the children ranked by who wants a human most, and a preview of the level
// below the row under the cursor, so descending is a confirmation rather than
// a gamble.
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { KpiVariantProps } from '../KPIDashboard';
import { buildEstate } from '../estate/kpiEstate';
import { EstateHeadline } from '../estate/EstateHeadline';
import { KT } from '../estate/kpiType';
import { nextMoveOf, nextMoveText } from '../estate/kpiNextMove';
import { useKpiAltitude } from '../estate/useKpiAltitude';
import { useLazyTrends } from '../useKpiOverview';
import { ledgerKpiIds } from './AttentionLedger.model';
import { largestClaim, sumDebts } from './ledger/kpiBooks';
import { childRows, kpiRows, rowsFor } from './ledger/bookRows';
import { BookRowLine } from './ledger/BookRow';
import { BookChanges } from './ledger/BookChanges';

export default function AttentionLedger({ overview, loading, onFocus, onOpen }: KpiVariantProps) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const estate = useMemo(() => buildEstate(overview), [overview]);
  const altitude = useKpiAltitude(estate);
  const rows = useMemo(() => rowsFor(estate, altitude.project), [estate, altitude.project]);
  const largest = useMemo(() => largestClaim(rows), [rows]);
  const owed = useMemo(() => sumDebts(rows), [rows]);
  // What each row's preview tooltip shows: its first rows one level down.
  const belowOf = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.id,
          r.kind === 'project' ? childRows(estate, r) : kpiRows(estate, r.projectId, r.groupId),
        ] as const),
      ),
    [estate, rows],
  );

  // Bounded: at most LEDGER_ID_CAP ids, in attention order, so one overview
  // can never turn into a fleet-wide bulk read.
  const ids = useMemo(() => ledgerKpiIds(altitude.project ? [altitude.project] : estate.projects), [estate, altitude.project]);
  const { trends, status, retry } = useLazyTrends(ids);

  if (loading && overview.length === 0) return <LedgerGhost />;

  const scopeTally = altitude.project ? altitude.project.tally : estate.tally;

  return (
    <div className="space-y-4" data-testid="kpi-ledger">
      <EstateHeadline estate={estate} project={altitude.project} onClimb={altitude.climb} />

      <p className={KT.figure}>
        {tx(o.books_balance, {
          total: scopeTally.total,
          measured: scopeTally.measured,
          owed: scopeTally.unmeasured,
        })}
      </p>
      <p className={KT.text}>{nextMoveText(nextMoveOf(scopeTally), t, tx)}</p>

      <BookChanges
        estate={estate}
        project={altitude.project}
        trends={trends}
        status={status}
        onRetry={retry}
        onOpen={onOpen}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse" data-testid="kpi-books-table">
          <caption className="sr-only">{o.books_caption}</caption>
          <thead>
            <tr className="border-b border-primary/10">
              <Th className="w-8 text-left">{o.books_rank}</Th>
              <Th className="w-[34%] text-left">{altitude.project ? o.books_group : o.books_project}</Th>
              <Th className="text-right">{o.books_declared}</Th>
              <Th className="text-right">{o.books_observed}</Th>
              <Th className="text-left">{o.books_composition}</Th>
              <Th className="text-right">{o.debt_reading}</Th>
              <Th className="text-right">{o.debt_verdict}</Th>
              <Th className="text-right">{o.debt_refresh}</Th>
              <Th className="text-right">{o.books_last_read}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <BookRowLine
                key={row.id}
                row={row}
                below={belowOf.get(row.id) ?? []}
                largest={largest}
                onOpen={() =>
                  row.kind === 'project'
                    ? altitude.descend(row.projectId)
                    : onFocus({ projectId: row.projectId, groupId: row.groupId ?? 'ungrouped' })
                }
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className={`py-2.5 pl-2 ${KT.meta}`}>
                {tx(o.books_footer, { rows: rows.length, total: scopeTally.total })}
              </td>
              <Td>{owed.reading}</Td>
              <Td>{owed.verdict}</Td>
              <Td>{owed.refresh}</Td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  // The same header token UnifiedTable uses, so this table and the app's
  // other tables have one header style.
  return <th className={`pb-2 pr-3 typo-label ${className}`}>{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className={`py-2.5 pr-3 text-right ${KT.figure}`}>{children}</td>;
}

/** Cold store, read in flight: the real geometry, invisible for its first
 *  ~150 ms so a fast read never flashes (docs/design/overview-loading.md). */
function LedgerGhost() {
  return (
    <div className="space-y-3" data-testid="kpi-ledger-ghost" aria-hidden="true">
      <span className="block h-8 w-72 rounded bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '150ms' }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="block h-10 rounded bg-primary/[0.06] animate-fade-in"
          style={{ animationDelay: `${185 + i * 30}ms` }}
        />
      ))}
    </div>
  );
}
