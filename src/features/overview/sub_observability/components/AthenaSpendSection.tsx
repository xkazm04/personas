import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { companionGetSpendRollup } from '@/api/companion';
import type { AthenaSpendRow } from '@/lib/bindings/AthenaSpendRow';
import { DataTable, KitButton, Meta, Section, sortRows, type TableRow, type TableSort } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { silentCatch } from '@/lib/silentCatch';

/**
 * "What does Athena cost" — the unified spend rollup, rendered inside the
 * Athena health panel.
 *
 * Reads `companion_get_spend_rollup`, which unions the two ledgers Athena's
 * spend was assumed to be split across (`companion_turn` and `dev_llm_spend`)
 * and tags every row with the ledger it came from. Per the audit behind that
 * command, no companion path currently writes `dev_llm_spend`, so today every
 * row reads `turn` — the column stays because a silently-inferred ledger is
 * how a future migration would double-count.
 *
 * Composed from the kit: a level-2 Section (totals in its meta) over a
 * DataTable, newest day first (every column sorts), 14 rows until Show all. The head always
 * renders; the table ghosts only while loading with no rows, so a refetch
 * never hides rows already on screen (pattern v2).
 */

type Col = 'day' | 'turns' | 'cost';
const SHOWN = 14;

/** Tab-local fetch keyed off the Overview day-range filter, mirroring `useAthenaHealth`. */
function useAthenaSpend() {
  const { effectiveDays } = useOverviewFilterValues();
  const [rows, setRows] = useState<AthenaSpendRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Bumped per request so a response for a day-range the user has already
  // navigated away from cannot clobber the range now on screen.
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    companionGetSpendRollup(effectiveDays)
      .then((r) => {
        if (seq !== seqRef.current) return;
        setRows(r);
      })
      .catch((e) => {
        if (seq !== seqRef.current) return;
        silentCatch('companion_get_spend_rollup')(e);
      })
      .finally(() => {
        if (seq !== seqRef.current) return;
        setLoading(false);
      });
  }, [effectiveDays]);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, loading };
}

export const AthenaSpendSection = memo(function AthenaSpendSection() {
  const { t, language } = useTranslation();
  const a = t.overview.athena;
  const { rows, loading } = useAthenaSpend();
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<TableSort<Col>>({ key: 'day', dir: 'desc' });

  const totalCost = useMemo(() => rows.reduce((sum, r) => sum + r.costUsd, 0), [rows]);
  const totalTurns = useMemo(() => rows.reduce((sum, r) => sum + r.turnCount, 0), [rows]);
  const ledgerLabel = useCallback(
    (ledger: string) => (ledger === 'dev_spend' ? a.spend_ledger_dev : a.spend_ledger_turn),
    [a.spend_ledger_dev, a.spend_ledger_turn],
  );

  const allRows: Array<TableRow<Col>> = rows.map((r) => ({
    id: `${r.ledger}:${r.day}:${r.origin}`,
    sort: { day: r.day, turns: r.turnCount, cost: r.costUsd },
    mark: { tone: r.ledger === 'dev_spend' ? 'external' : 'agent', glyph: 'soft', label: ledgerLabel(r.ledger) },
    cells: {
      day: (
        <div className="k-cell2">
          <span className="k-row__name typo-body k-strong">{r.day}</span>
          <span className="k-row__meta typo-caption"><Meta parts={[r.origin, ledgerLabel(r.ledger)]} /></span>
        </div>
      ),
      turns: <span className="typo-data k-regular"><Numeric value={r.turnCount} unit="count" /></span>,
      cost: <span className="typo-data k-regular"><Numeric value={r.costUsd} unit="usd" /></span>,
    },
  }));
  // Sorted over every row before the page is cut, so Show all never reorders what was on screen.
  const sorted = sortRows(allRows, sort, language);
  const table = all ? sorted : sorted.slice(0, SHOWN);

  return (
    <Section
      level={2}
      title={a.spend_title}
      meta={<Meta parts={[a.spend_hint, <Numeric key="c" value={totalCost} unit="usd" />, <Numeric key="n" value={totalTurns} unit="count" />]} />}
    >
      <div data-testid="athena-spend-section">
        <DataTable<Col>
          label={a.spend_title}
          loading={loading && rows.length === 0}
          cols={[
            { key: 'day', label: a.spend_day, sortable: 'desc' },
            { key: 'turns', label: a.spend_turns, num: true, sortable: 'desc' },
            { key: 'cost', label: a.spend_cost, num: true, sortable: 'desc' },
          ]}
          rows={table}
          sort={sort}
          onSortChange={setSort}
          locale={language}
          empty={{ title: a.spend_empty_title, hint: a.spend_empty_description }}
          pager={sorted.length > SHOWN && !all ? (
            <>
              <span className="typo-data k-regular k-quiet">{table.length} / {sorted.length}</span>
              <KitButton onClick={() => setAll(true)}>{t.overview.heartbeats.show_all}</KitButton>
            </>
          ) : undefined}
        />
      </div>
    </Section>
  );
});
