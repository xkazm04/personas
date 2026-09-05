import { ShieldCheck } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { StatusShape, mapToShapeStatus } from '@/features/shared/components/display/StatusShape';
import { getTrustTier } from '@/lib/personas/personaThresholds';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { useTranslation } from '@/i18n/useTranslation';

/* -- Health style map (also exported so filter dropdowns can stay in sync) --
   Labels resolve through i18n via `labelKey` into `t.agents.status`. */

export type HealthLabelKey = 'healthy' | 'degraded' | 'failing';

export const HEALTH_STYLES: Record<string, { bg: string; text: string; labelKey: HealthLabelKey }> = {
  healthy: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', labelKey: 'healthy' },
  degraded: { bg: 'bg-amber-500/10', text: 'text-amber-400', labelKey: 'degraded' },
  failing: { bg: 'bg-red-500/10', text: 'text-red-400', labelKey: 'failing' },
};

/* -- Row accent ------------------------------------------------------- */

export type RowAccentTone = 'building' | 'draft' | 'failing' | 'degraded' | 'healthy';

/**
 * ONE priority rule for the left-edge accent a persona row or card carries:
 * building beats draft beats failing beats degraded, else healthy. The grid
 * (PersonaOverviewPage) and the mobile card (PersonaOverviewCardList) each
 * map the tone to their own classes; the order and the health mapping live
 * here so the two surfaces cannot drift apart again.
 */
export function rowAccentTone(
  building: boolean,
  draft: boolean,
  health: PersonaHealth | undefined,
): RowAccentTone {
  if (building) return 'building';
  if (draft) return 'draft';
  if (health?.status === 'failing') return 'failing';
  if (health?.status === 'degraded') return 'degraded';
  return 'healthy';
}

/* -- Trust score bar -------------------------------------------------- */

export function TrustScoreBar({ score }: { score: number }) {
  const tier = getTrustTier(score);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`flex items-center gap-1 text-md font-semibold ${tier.color}`}>
        <ShieldCheck className="w-3.5 h-3.5" />
        {tier.label}
      </div>
    </div>
  );
}

/* -- Status badge ----------------------------------------------------- */

export function StatusBadge({
  enabled,
  health,
  isDraft,
  isArchived = false,
}: {
  enabled: boolean;
  health?: PersonaHealth;
  isDraft: boolean;
  isArchived?: boolean;
}) {
  const { t } = useTranslation();
  if (isArchived) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/15">
        {t.agents.persona_list.badge_archived}
      </span>
    );
  }
  if (isDraft) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/15">
        {t.agents.persona_list.badge_draft}
      </span>
    );
  }
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/15">
        {t.agents.persona_list.badge_disabled}
      </span>
    );
  }
  const healthStatus = health?.status ?? 'healthy';
  const style = (HEALTH_STYLES[healthStatus] ?? HEALTH_STYLES.healthy)!;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium ${style.bg} ${style.text} border border-current/15`}
    >
      <StatusShape status={mapToShapeStatus(healthStatus)} size="xs" colorClass="" />
      {t.agents.status[style.labelKey]}
    </span>
  );
}

/* -- Building badge --------------------------------------------------- */

export function BuildingBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium bg-violet-500/10 text-violet-400 border border-violet-500/15">
      <LoadingSpinner size="xs" />
      {t.agents.persona_list.badge_building}
    </span>
  );
}
