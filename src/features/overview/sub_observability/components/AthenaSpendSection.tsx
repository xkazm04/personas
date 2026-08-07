import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { companionGetSpendRollup } from '@/api/companion';
import type { AthenaSpendRow } from '@/lib/bindings/AthenaSpendRow';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
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
 * Loading follows pattern v2 by delegation: the heading and table chrome
 * always render, and `UnifiedTable` gets `isLoading` + `data` so the
 * ghost-under-header → settled-empty → rippling-rows machine is automatic and
 * a refetch never hides rows already on screen.
 */

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

  const totalCost = useMemo(() => rows.reduce((sum, r) => sum + r.costUsd, 0), [rows]);
  const totalTurns = useMemo(() => rows.reduce((sum, r) => sum + r.turnCount, 0), [rows]);

  const ledgerLabel = useCallback(
    (ledger: string) => (ledger === 'dev_spend' ? a.spend_ledger_dev : a.spend_ledger_turn),
    [a.spend_ledger_dev, a.spend_ledger_turn],
  );

  const columns = useMemo<TableColumn<AthenaSpendRow>[]>(
    () => [
      {
        key: 'day',
        label: a.spend_day,
        width: 'minmax(96px, 1fr)',
        sortable: true,
        render: (r) => <span className="typo-body text-foreground">{r.day}</span>,
      },
      {
        key: 'origin',
        label: a.spend_origin,
        width: 'minmax(96px, 1fr)',
        sortable: true,
        render: (r) => <span className="typo-body text-foreground truncate">{r.origin}</span>,
      },
      {
        key: 'ledger',
        label: a.spend_ledger,
        width: 'minmax(88px, 1fr)',
        sortable: true,
        render: (r) => (
          <span className="typo-caption text-foreground">{ledgerLabel(r.ledger)}</span>
        ),
      },
      {
        key: 'turnCount',
        label: a.spend_turns,
        width: 'minmax(64px, 0.6fr)',
        sortable: true,
        sortFn: (x, y) => x.turnCount - y.turnCount,
        render: (r) => <Numeric value={r.turnCount} unit="count" language={language} align="right" />,
      },
      {
        key: 'costUsd',
        label: a.spend_cost,
        width: 'minmax(80px, 0.7fr)',
        sortable: true,
        sortFn: (x, y) => x.costUsd - y.costUsd,
        render: (r) => (
          <Numeric
            value={r.costUsd}
            unit="usd"
            precision={2}
            language={language}
            align="right"
            className="text-foreground"
          />
        ),
      },
    ],
    [a, language, ledgerLabel],
  );

  return (
    <div className="space-y-2" data-testid="athena-spend-section">
      <div className="flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5 text-emerald-400" />
        <h4 className="typo-heading text-foreground">{a.spend_title}</h4>
        <span className="typo-caption text-foreground">{a.spend_hint}</span>
        <span className="ml-auto typo-caption text-foreground">
          <Numeric value={totalCost} unit="usd" precision={2} language={language} />
          {' · '}
          <Numeric value={totalTurns} unit="count" language={language} />
        </span>
      </div>
      <UnifiedTable
        columns={columns}
        data={rows}
        isLoading={loading}
        getRowKey={(r) => `${r.ledger}:${r.day}:${r.origin}`}
        density="compact"
        defaultSortKey="day"
        defaultSortDir="desc"
        emptyTitle={a.spend_empty_title}
        emptyDescription={a.spend_empty_description}
        ariaLabel={a.spend_title}
      />
    </div>
  );
});
