import { useTranslation } from '@/i18n/useTranslation';
import { GitCommit, ShieldAlert, AlertTriangle, Code2 } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { VerdictBadge } from './VerdictBadge';
import type { EvalRunSummary } from '@/lib/bindings/EvalRunSummary';

const VERDICT_RANK: Record<string, number> = {
  PRODUCTION: 4,
  PROMISING: 3,
  'NOT-READY': 2,
  BROKEN: 1,
};

/** Compact per-run status markers derived from the summary row. */
function GateIcons({ row }: { row: EvalRunSummary }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  return (
    <div className="flex items-center gap-1.5">
      {row.hasCodeTrack && (
        <Tooltip content={c.gate_code_track}>
          <Code2 className="w-3.5 h-3.5 text-sky-400" />
        </Tooltip>
      )}
      {row.delivered && (
        <Tooltip content={c.delivered}>
          <GitCommit className="w-3.5 h-3.5 text-emerald-400" />
        </Tooltip>
      )}
      {row.cascadeStalled && (
        <Tooltip content={c.cascade_stalled}>
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        </Tooltip>
      )}
      {row.selfVetoed && (
        <Tooltip content={c.self_vetoed}>
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
        </Tooltip>
      )}
    </div>
  );
}

interface RunHistoryViewProps {
  runs: EvalRunSummary[];
  onSelectRun: (runId: string) => void;
}

/** Sortable history of every eval run. */
export function RunHistoryView({ runs, onSelectRun }: RunHistoryViewProps) {
  const { t } = useTranslation();
  const c = t.overview.certification;

  const columns: TableColumn<EvalRunSummary>[] = [
    {
      key: 'team',
      label: c.col_team,
      width: 'minmax(140px, 1.4fr)',
      sortable: true,
      render: (row) => (
        <span className="typo-caption text-foreground/90 truncate">{row.team ?? '—'}</span>
      ),
    },
    {
      key: 'seed',
      label: c.col_seed,
      width: 'minmax(160px, 1.6fr)',
      sortable: true,
      render: (row) => (
        <span className="font-data typo-caption text-foreground/70 truncate">{row.seed ?? '—'}</span>
      ),
    },
    {
      key: 'verdict',
      label: c.col_verdict,
      width: '140px',
      sortable: true,
      sortFn: (a, b) =>
        (VERDICT_RANK[a.verdict ?? ''] ?? 0) - (VERDICT_RANK[b.verdict ?? ''] ?? 0),
      render: (row) => <VerdictBadge verdict={row.verdict} provisional={row.provisional} size="sm" />,
    },
    {
      key: 'teamScore',
      label: c.col_score,
      width: '70px',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => (a.teamScore ?? -1) - (b.teamScore ?? -1),
      render: (row) =>
        row.teamScore == null ? (
          <span className="typo-caption text-foreground/40">—</span>
        ) : (
          <Numeric value={row.teamScore} unit="plain" align="right" className="text-foreground/90" />
        ),
    },
    {
      key: 'gates',
      label: c.col_gates,
      width: '90px',
      render: (row) => <GateIcons row={row} />,
    },
    {
      key: 'startedAt',
      label: c.col_started,
      width: '100px',
      sortable: true,
      sortFn: (a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''),
      render: (row) => (
        <RelativeTime timestamp={row.startedAt} className="typo-caption text-foreground/60" />
      ),
    },
  ];

  return (
    <UnifiedTable
      columns={columns}
      data={runs}
      getRowKey={(row) => row.runId}
      onRowClick={(row) => onSelectRun(row.runId)}
      density="compact"
      defaultSortKey="startedAt"
      defaultSortDir="desc"
      emptyTitle={c.empty_title}
      emptyDescription={c.empty_desc}
      ariaLabel={c.tab_history}
    />
  );
}
