import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { VERDICT_CONFIG } from './VerdictBadge';

/** Fixed display order for the verdict distribution (NOT BTreeMap order). */
export const VERDICT_ORDER = ['PRODUCTION', 'PROMISING', 'NOT-READY', 'BROKEN'] as const;
const VERDICT_BAR: Record<string, string> = {
  PRODUCTION: 'bg-emerald-500',
  PROMISING: 'bg-amber-500',
  'NOT-READY': 'bg-rose-500',
  BROKEN: 'bg-red-600',
};

/** Consecutive held-out PRODUCTION verdicts needed to certify a team. */
export const CERT_TARGET = 3;

/** Streak pips plus the "Certified" / "n/3 streak" caption. */
export function StreakCell({ streak, certified }: { streak: number; certified: boolean }) {
  const { t } = useTranslation();
  const c = t.overview.certification;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex items-center gap-1 shrink-0">
        {Array.from({ length: CERT_TARGET }, (_, i) => (
          <span
            key={i}
            className={`w-2.5 h-2.5 rounded-full border ${
              i < streak
                ? certified ? 'bg-emerald-400 border-emerald-400' : 'bg-amber-400 border-amber-400'
                : 'bg-transparent border-primary/25'
            }`}
          />
        ))}
      </div>
      <span className={`typo-caption truncate ${certified ? 'text-emerald-400' : 'text-foreground'}`}>
        {certified ? c.certified : `${streak}/${CERT_TARGET} ${c.streak_label}`}
      </span>
    </div>
  );
}

/** Stacked verdict-distribution bar; each segment names its verdict and count. */
export function DistributionCell({ counts }: { counts: Record<string, number | undefined> }) {
  const { t } = useTranslation();
  const total = VERDICT_ORDER.reduce((s, v) => s + (counts[v] ?? 0), 0);
  if (total === 0) return <span className="typo-caption text-foreground">—</span>;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary/40">
      {VERDICT_ORDER.map((v) => {
        const n = counts[v] ?? 0;
        if (n === 0) return null;
        const label = tokenLabel(t, 'verdict', VERDICT_CONFIG[v]!.tokenKey);
        return (
          <Tooltip key={v} content={`${label}: ${n}`}>
            <div className={`h-full ${VERDICT_BAR[v]}`} style={{ width: `${(n / total) * 100}%` }} />
          </Tooltip>
        );
      })}
    </div>
  );
}
