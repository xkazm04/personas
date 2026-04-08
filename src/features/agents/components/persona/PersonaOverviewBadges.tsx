import { ShieldCheck } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { StatusShape, mapToShapeStatus } from '@/features/shared/components/display/StatusShape';
import { getTrustTier } from '@/lib/personas/personaThresholds';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

/* -- Health style map (also exported so filter dropdowns can stay in sync) -- */

export const HEALTH_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  healthy: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Healthy' },
  degraded: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Degraded' },
  failing: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Failing' },
};

/* -- Trust score bar -------------------------------------------------- */

export function TrustScoreBar({ score }: { score: number }) {
  const tier = getTrustTier(score);
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`flex items-center gap-1 text-md font-semibold ${tier.color}`}>
        <ShieldCheck className="w-3.5 h-3.5" />
        {tier.label}
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden min-w-[40px]">
        <div
          className={`h-full rounded-full transition-all duration-500 ${tier.bar}`}
          style={{ width: `${Math.round(score)}%` }}
        />
      </div>
      <span className={`text-md font-medium tabular-nums ${tier.color}`}>
        {Math.round(score)}
      </span>
    </div>
  );
}

/* -- Status badge ----------------------------------------------------- */

export function StatusBadge({
  enabled,
  health,
  isDraft,
}: {
  enabled: boolean;
  health?: PersonaHealth;
  isDraft: boolean;
}) {
  if (isDraft) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/15">
        Draft
      </span>
    );
  }
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/15">
        Disabled
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
      {style.label}
    </span>
  );
}

/* -- Building badge --------------------------------------------------- */

export function BuildingBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-md font-medium bg-violet-500/10 text-violet-400 border border-violet-500/15">
      <LoadingSpinner size="xs" />
      Building
    </span>
  );
}
