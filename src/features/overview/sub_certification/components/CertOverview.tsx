import { useTranslation } from '@/i18n/useTranslation';
import { ShieldCheck } from 'lucide-react';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { TeamCertCard } from './TeamCertCard';
import type { TeamCertStatus } from '@/lib/bindings/TeamCertStatus';

interface CertOverviewProps {
  certStatus: TeamCertStatus[];
  onSelectRun: (runId: string) => void;
  /**
   * One-shot per-card entrance tracker owned by `CertificationCommandCenter`
   * (docs/design/overview-loading.md) — it survives this component's mount
   * lifetime, so switching tabs away and back never replays the cascade.
   */
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
}

/** Grid of per-team certification cards. */
export function CertOverview({ certStatus, onSelectRun, hasEntered, markEntered }: CertOverviewProps) {
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
        {certStatus.map((s, index) => (
          <RevealItem
            key={s.teamId}
            revealId={s.teamId}
            order={index}
            hasEntered={hasEntered}
            markEntered={markEntered}
          >
            <TeamCertCard status={s} onSelectRun={onSelectRun} />
          </RevealItem>
        ))}
      </div>
    </div>
  );
}
