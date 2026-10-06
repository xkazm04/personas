/**
 * The evidence ledger for the RailBelow prototype variants: the same
 * `UnifiedTable` contract as `blocks/EvidenceLedger` (cold-load ghost, settled
 * empty state, one-shot row reveal keyed on the step) with the CELLS supplied by
 * the variant. Column keys, order and sorts stay the baseline's, so the ledger
 * answers the same question in every variant and only its row components differ.
 */
import { useMemo } from 'react';

import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { Translations } from '@/i18n/en';

import { useLifecycleViewModel } from './context';
import { evidenceRowsFor, type EvidenceRow } from './blocks/evidenceRows';

interface VariantLedgerProps {
  columnsFor: (t: Translations) => TableColumn<EvidenceRow>[];
  tableId: string;
  rowHeight?: number;
  rowAccent?: (r: EvidenceRow) => string | undefined;
}

/** The baseline's accent: a bad outcome marks its row edge. */
const ACCENT = (r: EvidenceRow) =>
  r.outcome === 'failed' ? 'border-l-status-error/70'
    : r.outcome === 'skipped' ? 'border-l-status-warning/70'
      : undefined;

export function VariantLedger({ columnsFor, tableId, rowHeight = 40, rowAccent = ACCENT }: VariantLedgerProps) {
  const { t, dl, evidence, selected, loading, error, refetch } = useLifecycleViewModel();
  const columns = useMemo(() => columnsFor(t), [columnsFor, t]);
  const rows = useMemo(() => evidenceRowsFor(selected?.id ?? null, evidence), [selected, evidence]);

  return (
    <UnifiedTable
      columns={columns}
      data={rows}
      getRowKey={(r) => r.key}
      isLoading={loading}
      error={error}
      onRetry={refetch}
      emptyTitle={dl.lc_detail_no_evidence}
      rowHeight={rowHeight}
      density="compact"
      tableId={tableId}
      ariaLabel={dl.lc_detail_evidence}
      defaultSortKey="when"
      defaultSortDir="desc"
      rowAccent={rowAccent}
      rowReveal={{ resetKey: selected?.id ?? 'none' }}
      className="h-full"
    />
  );
}
