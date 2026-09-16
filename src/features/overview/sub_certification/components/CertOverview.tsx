import { useTranslation } from '@/i18n/useTranslation';
import { ShieldCheck, Shield } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { VerdictBadge, VERDICT_RANK } from './VerdictBadge';
import { StreakCell, DistributionCell } from './TeamCertCells';
import type { TeamCertStatus } from '@/lib/bindings/TeamCertStatus';

interface CertOverviewProps {
  certStatus: TeamCertStatus[];
  onSelectRun: (runId: string) => void;
}

/**
 * Certification ledger — one team per row: latest verdict, certification
 * streak, verdict distribution over held-out runs. A row opens the team's
 * latest run. Same `UnifiedTable` as the Run History tab beside it, so the
 * two tabs read as one surface.
 */
export function CertOverview({ certStatus, onSelectRun }: CertOverviewProps) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const certifiedCount = certStatus.filter((s) => s.certified).length;

  const columns: TableColumn<TeamCertStatus>[] = [
    {
      key: 'team',
      label: c.col_team,
      width: 'minmax(180px, 1.6fr)',
      sortable: true,
      render: (s) => {
        const Icon = s.certified ? ShieldCheck : Shield;
        return (
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`w-4 h-4 shrink-0 ${s.certified ? 'text-emerald-400' : 'text-foreground'}`} />
            <span className="typo-body text-foreground truncate">{s.team}</span>
          </div>
        );
      },
    },
    {
      key: 'latestVerdict',
      label: c.col_verdict,
      width: '140px',
      sortable: true,
      sortFn: (a, b) => (VERDICT_RANK[a.latestVerdict ?? ''] ?? 0) - (VERDICT_RANK[b.latestVerdict ?? ''] ?? 0),
      render: (s) => <VerdictBadge verdict={s.latestVerdict} size="sm" />,
    },
    {
      key: 'streak',
      label: c.col_streak,
      width: '170px',
      sortable: true,
      sortFn: (a, b) => a.streak - b.streak,
      render: (s) => <StreakCell streak={s.streak} certified={s.certified} />,
    },
    {
      key: 'distribution',
      label: c.col_distribution,
      width: 'minmax(160px, 1.4fr)',
      render: (s) => <DistributionCell counts={s.verdictCounts} />,
    },
    {
      key: 'heldOutRuns',
      label: c.col_held_out,
      width: '110px',
      align: 'right',
      sortable: true,
      sortFn: (a, b) => a.heldOutRuns - b.heldOutRuns,
      render: (s) => <Numeric value={s.heldOutRuns} unit="plain" align="right" className="typo-body text-foreground" />,
    },
  ];

  return (
    <div className="space-y-3">
      {certStatus.length > 0 && (
        <div className="flex items-center gap-2 typo-caption text-foreground">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{certifiedCount}/{certStatus.length} {c.teams_certified}</span>
        </div>
      )}
      <UnifiedTable
        columns={columns}
        data={certStatus}
        getRowKey={(s) => s.teamId}
        rowHeight={44}
        className="max-h-[70vh]"
        rowReveal={{}}
        onRowClick={(s) => { if (s.latestRunId) onSelectRun(s.latestRunId); }}
        rowAccent={(s) => (s.certified ? 'border-l-emerald-400' : undefined)}
        defaultSortKey="streak"
        defaultSortDir="desc"
        tableId="cert-overview"
        emptyTitle={c.empty_title}
        emptyDescription={c.empty_desc}
        ariaLabel={c.tab_overview}
      />
    </div>
  );
}
