import { useTranslation } from '@/i18n/useTranslation';
import { ShieldCheck, Shield } from 'lucide-react';
import { VerdictBadge } from './VerdictBadge';
import type { TeamCertStatus } from '@/lib/bindings/TeamCertStatus';

/** Fixed display order for the verdict-distribution bar (NOT BTreeMap order). */
const VERDICT_ORDER = ['PRODUCTION', 'PROMISING', 'NOT-READY', 'BROKEN'] as const;
const VERDICT_BAR: Record<string, string> = {
  PRODUCTION: 'bg-emerald-500',
  PROMISING: 'bg-amber-500',
  'NOT-READY': 'bg-rose-500',
  BROKEN: 'bg-red-600',
};

const CERT_TARGET = 3;

function StreakPips({ streak, certified }: { streak: number; certified: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: CERT_TARGET }, (_, i) => (
        <span
          key={i}
          className={`w-2.5 h-2.5 rounded-full border ${
            i < streak
              ? certified
                ? 'bg-emerald-400 border-emerald-400'
                : 'bg-amber-400 border-amber-400'
              : 'bg-transparent border-primary/25'
          }`}
        />
      ))}
    </div>
  );
}

function DistributionBar({ counts }: { counts: Record<string, number | undefined> }) {
  const total = VERDICT_ORDER.reduce((s, v) => s + (counts[v] ?? 0), 0);
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary/40">
      {VERDICT_ORDER.map((v) => {
        const n = counts[v] ?? 0;
        if (n === 0) return null;
        return (
          <div
            key={v}
            className={VERDICT_BAR[v]}
            style={{ width: `${(n / total) * 100}%` }}
            title={`${v}: ${n}`}
          />
        );
      })}
    </div>
  );
}

interface TeamCertCardProps {
  status: TeamCertStatus;
  onSelectRun: (runId: string) => void;
}

/** One team's certification status — streak ring, latest verdict, distribution. */
export function TeamCertCard({ status, onSelectRun }: TeamCertCardProps) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  const Icon = status.certified ? ShieldCheck : Shield;

  const clickable = !!status.latestRunId;
  const onClick = () => {
    if (status.latestRunId) onSelectRun(status.latestRunId);
  };

  return (
    <div
      className={`rounded-modal border p-4 space-y-3 transition-colors ${
        status.certified
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-primary/10 bg-secondary/20'
      } ${clickable ? 'cursor-pointer hover:bg-secondary/40' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-4 h-4 shrink-0 ${status.certified ? 'text-emerald-400' : 'text-foreground/60'}`} />
          <span className="typo-heading text-foreground/90 truncate">{status.team}</span>
        </div>
        <VerdictBadge verdict={status.latestVerdict} size="sm" />
      </div>

      <div className="flex items-center justify-between">
        <StreakPips streak={status.streak} certified={status.certified} />
        <span className="typo-caption text-foreground">
          {status.certified ? c.certified : `${status.streak}/${CERT_TARGET} ${c.streak_label}`}
        </span>
      </div>

      <DistributionBar counts={status.verdictCounts} />

      <div className="typo-caption text-foreground">
        {status.heldOutRuns} {c.held_out_runs}
      </div>
    </div>
  );
}
