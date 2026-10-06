/**
 * The evidence ledger: the snapshot's recent changes as a real table, joined to
 * the selected step. One row per change; Outcome and Detail are that change's
 * result FOR THAT STEP.
 *
 * `display/UnifiedTable` with a `tableId`, following
 * `overview/sub_events/components/EventLogList.tsx`: the table owns the whole
 * cold-load contract (ghost rows under its permanent column header, the
 * settled-only empty state, the one-shot row reveal) from `isLoading` + `data`,
 * so nothing here hand-rolls a skeleton. `rowReveal.resetKey` is the step id,
 * so walking the timeline re-ripples the same rows under their new outcomes -
 * which is the signal that the ledger answered a new question.
 */
import { useMemo } from 'react';

import { UnifiedTable } from '@/features/shared/components/display/UnifiedTable';

import { useLifecycleViewModel } from '../context';
import { evidenceColumns } from './evidenceColumns';
import { evidenceRowsFor } from './evidenceRows';

const ROW_HEIGHT = 40;

export function EvidenceLedger({ className = 'h-full' }: { className?: string }) {
  const { t, dl, evidence, selected, loading, error, refetch } = useLifecycleViewModel();
  const columns = useMemo(() => evidenceColumns(t), [t]);
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
      rowHeight={ROW_HEIGHT}
      density="compact"
      tableId="lifecycle-evidence"
      ariaLabel={dl.lc_detail_evidence}
      defaultSortKey="when"
      defaultSortDir="desc"
      rowAccent={(r) =>
        r.outcome === 'failed' ? 'border-l-status-error/70'
          : r.outcome === 'skipped' ? 'border-l-status-warning/70'
            : undefined
      }
      rowReveal={{ resetKey: selected?.id ?? 'none' }}
      className={className}
    />
  );
}
