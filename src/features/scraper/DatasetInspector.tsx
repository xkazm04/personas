import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

import type { DatasetRecord } from '@/api/scraper';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';

/** Matches the backend page size `useScraperData.queryDataset` asks for. */
const PAGE_SIZE = 100;

/**
 * What landed. The operator's handoff after Run/Test: the dataset chips carry
 * a count, this panel carries the records behind it.
 *
 * A failed query is NOT an empty dataset — `queryDataset` resolves to `null`
 * when the read failed (and has already toasted), so the panel says so and
 * offers a retry instead of rendering a convincing "no records yet".
 */
export function DatasetInspector({
  name,
  queryDataset,
  onClose,
}: {
  name: string;
  queryDataset: (name: string, changedOnly?: boolean) => Promise<DatasetRecord[] | null>;
  onClose: () => void;
}) {
  const [records, setRecords] = useState<DatasetRecord[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [changedOnly, setChangedOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await queryDataset(name, changedOnly);
    setFailed(rows === null);
    setRecords(rows ?? []);
    setLoading(false);
  }, [name, changedOnly, queryDataset]);

  useEffect(() => { void load(); }, [load]);

  const columns: TableColumn<DatasetRecord>[] = [
    {
      key: 'key',
      label: 'Key',
      width: 'minmax(140px, 1fr)',
      render: (r) => <span className="typo-caption text-foreground truncate">{r.key}</span>,
    },
    {
      key: 'data',
      label: 'Record',
      width: 'minmax(200px, 2fr)',
      render: (r) => (
        <span className="typo-caption text-foreground truncate">{summarise(r.data)}</span>
      ),
    },
    {
      key: 'lastSeen',
      label: 'Last seen',
      width: '120px',
      render: (r) => <RelativeTime timestamp={r.lastSeen} className="typo-caption text-foreground" />,
    },
    {
      key: 'updatedAt',
      label: 'Changed',
      width: '120px',
      render: (r) => <RelativeTime timestamp={r.updatedAt} className="typo-caption text-foreground" />,
    },
  ];

  return (
    <div className="rounded-card border border-primary/12 bg-secondary/20">
      <header className="flex items-center gap-3 border-b border-primary/8 px-4 py-2.5">
        <span className="typo-card-label text-foreground">{name}</span>
        <span className="typo-caption text-muted-foreground">
          {records.length}{records.length === PAGE_SIZE ? '+' : ''} records
        </span>
        <AccessibleToggle
          className="ml-auto"
          size="sm"
          checked={changedOnly}
          onChange={() => setChangedOnly((v) => !v)}
          label="Changed only"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${name} inspector`}
          className="rounded-interactive p-1 text-foreground hover:bg-secondary/60 transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </header>

      {failed ? (
        <div className="flex items-center gap-3 px-4 py-4">
          <AlertTriangle className="size-4 text-status-warning shrink-0" />
          <p className="typo-caption text-foreground flex-1">
            Could not read this dataset. Nothing here means the read failed, not that the dataset is empty.
          </p>
          <Button variant="secondary" size="xs" onClick={() => void load()}>Retry</Button>
        </div>
      ) : (
        <UnifiedTable
          columns={columns}
          data={records}
          getRowKey={(r) => r.key}
          isLoading={loading}
          density="compact"
          /* Datasets grow with every scrape run; window the body so a large
             dataset never maps every record into the DOM (long-list-rendering). */
          rowHeight={36}
          emptyTitle={changedOnly ? 'Nothing changed in the last run' : 'No records stored yet'}
          emptyDescription={changedOnly ? undefined : 'Run this scrape to populate the dataset.'}
        />
      )}
    </div>
  );
}

/** One-line preview of a record's payload — field names first, so two rows of
 *  the same shape are distinguishable at a glance. */
function summarise(data: Record<string, unknown> | string): string {
  if (typeof data === 'string') return data;
  const parts = Object.entries(data).map(([k, v]) => `${k}: ${stringify(v)}`);
  return parts.join(' · ');
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return Array.isArray(value) ? `[${value.length}]` : '{…}';
}
