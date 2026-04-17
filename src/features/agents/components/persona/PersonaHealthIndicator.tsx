import { Check, Minus, X } from 'lucide-react';
import { PersonaAvatar } from '@/features/shared/components/display/PersonaAvatar';
import { useTranslation } from '@/i18n/useTranslation';
import { StatusShape, mapToShapeStatus } from '@/features/shared/components/display/StatusShape';
import type { Persona } from '@/lib/types/types';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
type HealthLevel = 'healthy' | 'degraded' | 'failing' | 'dormant';

const HEALTH_RING_CLASS: Record<HealthLevel, string> = {
  healthy: `ring-2 ring-emerald-400/40`,
  degraded: `border-2 border-dashed border-amber-400/40`,
  failing: `ring-2 ring-red-400/50`,
  dormant: `border-2 border-dashed border-muted-foreground/15`,
};

const HEALTH_LABEL: Record<HealthLevel, string> = {
  healthy: 'healthy',
  degraded: 'mixed',
  failing: 'failing',
  dormant: 'inactive',
};

interface PersonaHealthIndicatorProps {
  persona: Persona;
  health?: PersonaHealth;
}

export function PersonaHealthIndicator({ persona, health }: PersonaHealthIndicatorProps) {
  const { t, tx } = useTranslation();
  const healthStatus = (health?.status ?? 'dormant') as HealthLevel;
  const ringClass = HEALTH_RING_CLASS[healthStatus] ?? HEALTH_RING_CLASS.dormant;
  const statuses = health?.recentStatuses;
  const successCount = statuses?.filter((s) => s === 'completed').length ?? 0;
  const srLabel = `Health: ${HEALTH_LABEL[healthStatus]}, ${successCount} of ${statuses?.length ?? 0} recent runs succeeded`;

  const HealthShape = healthStatus === 'healthy'
    ? Check
    : healthStatus === 'failing'
      ? X
      : Minus;

  return (
    <div className="relative group/health">
      <span className="sr-only">{srLabel}</span>
      <div className={`rounded-card ${ringClass}`}>
        <PersonaAvatar icon={persona.icon} name={persona.name} color={persona.color} size="md" fallbackStyle="bot" />
      </div>
      {healthStatus !== 'dormant' && (
        <div
          className="absolute -right-1 -bottom-1 w-4 h-4 rounded-full border border-background bg-background/95 flex items-center justify-center"
          aria-hidden="true"
        >
          <HealthShape className="w-2.5 h-2.5 text-foreground/80" />
        </div>
      )}
      {statuses && statuses.length > 0 && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/health:flex group-focus-within/health:flex items-center gap-1 px-2 py-1.5 rounded-card bg-popover border border-primary/20 shadow-elevation-3 z-20 whitespace-nowrap">
          {statuses.map((s, si) => (
            <StatusShape
              key={si}
              status={mapToShapeStatus(s)}
              title={s}
              tabIndex={0}
              aria-label={`Run ${si + 1}: ${s}`}
            />
          ))}
          <span className="text-sm text-muted-foreground/90 ml-1">{tx(t.agents.health_indicator.last, { count: statuses.length })}</span>
        </div>
      )}
    </div>
  );
}
