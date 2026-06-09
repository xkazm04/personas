import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { GroundingEntry } from '@/lib/bindings/GroundingEntry';

function pctColor(pct: number | null): string {
  if (pct == null) return 'text-foreground/50';
  if (pct >= 90) return 'text-emerald-400';
  if (pct >= 70) return 'text-amber-400';
  return 'text-rose-400';
}

/** Per-file citation-grounding validity from the scorecard. */
export function GroundingTable({ grounding }: { grounding: GroundingEntry[] }) {
  const { t } = useTranslation();
  const c = t.overview.certification;

  const columns: TableColumn<GroundingEntry>[] = [
    {
      key: 'file',
      label: c.grounding_file,
      width: 'minmax(180px, 2fr)',
      sortable: true,
      render: (row) => <span className="font-data typo-caption text-foreground/90">{row.file ?? '—'}</span>,
    },
    {
      key: 'valid',
      label: c.grounding_valid,
      width: '110px',
      align: 'right',
      render: (row) => (
        <span className="typo-caption text-foreground">
          {row.valid ?? 0}/{row.total ?? 0}
        </span>
      ),
    },
    {
      key: 'pct',
      label: c.grounding_pct,
      width: '80px',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => (a.pct ?? -1) - (b.pct ?? -1),
      render: (row) =>
        row.pct == null ? (
          <span className="typo-caption text-foreground" title={c.grounding_na}>
            n/a
          </span>
        ) : (
          <Numeric value={row.pct} unit="percent" precision={0} align="right" className={pctColor(row.pct)} />
        ),
    },
    {
      key: 'invalid',
      label: c.grounding_invalid,
      width: '90px',
      align: 'right',
      render: (row) =>
        row.invalid.length === 0 ? (
          <span className="typo-caption text-foreground">0</span>
        ) : (
          <Tooltip content={row.invalid.join(', ')}>
            <span className="typo-caption text-rose-400 underline decoration-dotted cursor-help">
              {row.invalid.length}
            </span>
          </Tooltip>
        ),
    },
  ];

  return (
    <UnifiedTable
      columns={columns}
      data={grounding}
      getRowKey={(row) => row.file ?? Math.random().toString(36)}
      density="compact"
      borderless
      defaultSortKey="pct"
      defaultSortDir="asc"
      ariaLabel={c.grounding_title}
    />
  );
}
