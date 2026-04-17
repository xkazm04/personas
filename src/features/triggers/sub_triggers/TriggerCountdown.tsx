import { useState, useEffect, useCallback } from 'react';
import type { PersonaTrigger } from '@/lib/types/types';
import { parseTriggerConfig } from '@/lib/utils/platform/triggerConstants';
import { formatCountdown } from '@/lib/utils/formatters';
import { TRIGGER_RING_COLORS } from './triggerListTypes';
import { RadialCountdownRing } from './RadialCountdownRing';
import { useTranslation } from '@/i18n/useTranslation';

/** Compute the next trigger time in ms (epoch), or null if not applicable. */
export function getNextTriggerMs(trigger: PersonaTrigger): number | null {
  if (!trigger.enabled) return null;
  if (trigger.trigger_type === 'manual' || trigger.trigger_type === 'webhook' || trigger.trigger_type === 'chain') return null;

  // Prefer the backend-computed next_trigger_at (works for cron + interval triggers)
  if (trigger.next_trigger_at) {
    const nextMs = new Date(trigger.next_trigger_at).getTime();
    if (!isNaN(nextMs)) return nextMs;
  }

  // Fallback: compute from last_triggered_at + interval_seconds
  if (trigger.last_triggered_at && trigger.config) {
    const config = parseTriggerConfig(trigger.trigger_type, trigger.config);
    if ((config.type === 'schedule' || config.type === 'polling') && config.interval_seconds) {
      const lastTrigger = new Date(trigger.last_triggered_at).getTime();
      return lastTrigger + config.interval_seconds * 1000;
    }
  }
  return null;
}

/** Compute the total interval (in seconds) for progress fraction. */
export function getTotalIntervalSeconds(trigger: PersonaTrigger): number {
  // From parsed config
  if (trigger.config) {
    const config = parseTriggerConfig(trigger.trigger_type, trigger.config);
    if ((config.type === 'schedule' || config.type === 'polling') && config.interval_seconds) {
      return config.interval_seconds;
    }
  }
  // From next_trigger_at - last_triggered_at
  if (trigger.next_trigger_at && trigger.last_triggered_at) {
    const nextMs = new Date(trigger.next_trigger_at).getTime();
    const lastMs = new Date(trigger.last_triggered_at).getTime();
    if (!isNaN(nextMs) && !isNaN(lastMs) && nextMs > lastMs) {
      return Math.floor((nextMs - lastMs) / 1000);
    }
  }
  return 300; // fallback 5 minutes
}

/** Live countdown for schedule/polling triggers */
export function TriggerCountdown({ trigger, accentColorClass }: { trigger: PersonaTrigger; accentColorClass: string }) {
  const { t } = useTranslation();
  const computeRemaining = useCallback(() => {
    const nextMs = getNextTriggerMs(trigger);
    if (nextMs === null) return null;
    return Math.floor((nextMs - Date.now()) / 1000);
  }, [trigger]);

  const [remaining, setRemaining] = useState(computeRemaining);
  const [firing, setFiring] = useState(false);

  useEffect(() => {
    setRemaining(computeRemaining());
    setFiring(false);
  }, [computeRemaining]);

  useEffect(() => {
    if (remaining === null) return;

    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null) return null;
        const next = prev - 1;
        if (next <= 0) {
          setFiring(true);
          setTimeout(() => setFiring(false), 2000);
          // Re-calculate after firing animation
          const fresh = computeRemaining();
          return fresh !== null ? Math.max(fresh, 0) : 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [remaining === null, computeRemaining]);

  if (!trigger.enabled) return <span className="typo-body text-foreground">{t.triggers.disabled_label}</span>;
  if (trigger.trigger_type === 'manual') return <span className="typo-body text-foreground">{t.triggers.manual_label}</span>;
  if (trigger.trigger_type === 'webhook') return <span className="typo-body text-foreground">{t.triggers.webhook_label}</span>;
  if (trigger.trigger_type === 'chain') return <span className="typo-body text-foreground">{t.triggers.chain_label}</span>;
  if (remaining === null) return <span className="typo-body text-foreground">{t.triggers.pending_label}</span>;

  const total = getTotalIntervalSeconds(trigger);
  const accentColor = TRIGGER_RING_COLORS[accentColorClass] ?? '#c084fc';

  if (firing || remaining <= 0) {
    return (
      <RadialCountdownRing remaining={0} total={total} firing accentColor={accentColor}>
        <span className="typo-heading font-semibold text-emerald-400 leading-none">{t.triggers.fire_label}</span>
      </RadialCountdownRing>
    );
  }

  // Compact label: use short format for the ring interior
  const compactLabel = remaining >= 3600
    ? `${Math.floor(remaining / 3600)}h`
    : remaining >= 60
      ? `${Math.floor(remaining / 60)}m`
      : `${remaining}s`;

  return (
    <RadialCountdownRing remaining={remaining} total={total} firing={false} accentColor={accentColor}>
      <span className="typo-code font-mono font-semibold text-foreground leading-none" title={`in ${formatCountdown(remaining)}`}>
        {compactLabel}
      </span>
    </RadialCountdownRing>
  );
}
