import { useTranslation } from '@/i18n/useTranslation';
import { ShieldCheck } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { TeamCertCard } from './TeamCertCard';
import type { TeamCertStatus } from '@/lib/bindings/TeamCertStatus';

interface CertOverviewProps {
  certStatus: TeamCertStatus[];
  onSelectRun: (runId: string) => void;
}

/** Grid of per-team certification cards. */
export function CertOverview({ certStatus, onSelectRun }: CertOverviewProps) {
  const { t } = useTranslation();
  const c = t.overview.certification;

  if (certStatus.length === 0) {
    return <EmptyState icon={ShieldCheck} title={c.empty_title} subtitle={c.empty_desc} />;
  }

  const certifiedCount = certStatus.filter((s) => s.certified).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 typo-caption text-foreground">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <span>
          {certifiedCount}/{certStatus.length} {c.teams_certified}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {certStatus.map((s) => (
          <TeamCertCard key={s.teamId} status={s} onSelectRun={onSelectRun} />
        ))}
      </div>
    </div>
  );
}
