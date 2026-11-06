import { ShieldCheck } from 'lucide-react';
import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { getTrustTier } from '@/lib/personas/personaThresholds';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { useTranslation } from '@/i18n/useTranslation';

/* -- Health style map (also exported so filter dropdowns can stay in sync) --
   Labels resolve through i18n via `labelKey` into `t.agents.status`. */

export type HealthLabelKey = 'healthy' | 'degraded' | 'failing' | 'dormant' | 'unknown';

export const HEALTH_STYLES: Record<string, { state: StateMarkState; labelKey: HealthLabelKey }> = {
  healthy: { state: 'success', labelKey: 'healthy' },
  degraded: { state: 'warning', labelKey: 'degraded' },
  failing: { state: 'error', labelKey: 'failing' },
  // Never ran: no verdict either way, so it must not read as a verified Healthy.
  dormant: { state: 'neutral', labelKey: 'dormant' },
  // No health entry at all (summaries not loaded yet, or the read failed): no
  // verdict was reached, so it is neutral like dormant - never a green Healthy.
  unknown: { state: 'neutral', labelKey: 'unknown' },
};

/** The health key a persona is shown and filtered under: a missing entry, or a
 *  status this map does not know, is `unknown` - never a coerced `healthy`. */
export function healthKeyOf(health: PersonaHealth | undefined): string {
  const status = health?.status;
  return status && status in HEALTH_STYLES ? status : 'unknown';
}

/* -- Row accent ------------------------------------------------------- */

export type RowAccentTone = 'building' | 'draft' | 'failing' | 'degraded' | 'dormant' | 'unknown' | 'healthy';

/**
 * ONE priority rule for the left-edge accent a persona row or card carries:
 * building beats draft beats failing beats degraded; healthy only for a real
 * healthy verdict, and a missing one is unknown. The grid
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
  if (health?.status === 'dormant') return 'dormant';
  if (health?.status === 'healthy') return 'healthy';
  return 'unknown';
}

/* -- Trust score bar -------------------------------------------------- */

export function TrustScoreBar({ score }: { score: number }) {
  const tier = getTrustTier(score);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`flex items-center gap-1 typo-code text-ink-2`}>
        <ShieldCheck className="w-3.5 h-3.5" />
        {tier.label}
      </div>
    </div>
  );
}

/* -- Status mark ------------------------------------------------------ */

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
  if (isArchived) return <StateMark state="skipped" label={t.agents.persona_list.badge_archived} />;
  if (isDraft) return <StateMark state="blank" label={t.agents.persona_list.badge_draft} />;
  if (!enabled) return <StateMark state="skipped" label={t.agents.persona_list.badge_disabled} />;
  const style = HEALTH_STYLES[healthKeyOf(health)]!;
  return <StateMark state={style.state} label={t.agents.status[style.labelKey]} />;
}

/* -- Building mark ---------------------------------------------------- */

export function BuildingBadge() {
  const { t } = useTranslation();
  return <StateMark state="running" label={t.agents.persona_list.badge_building} />;
}
