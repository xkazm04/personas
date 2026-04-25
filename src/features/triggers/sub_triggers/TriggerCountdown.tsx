import { useMemo, useSyncExternalStore } from 'react';
import type { PersonaTrigger } from '@/lib/types/types';
import { parseTriggerConfig } from '@/lib/utils/platform/triggerConstants';
import { formatCountdown } from '@/lib/utils/formatters';
import { TRIGGER_RING_COLORS } from './triggerListTypes';
import { RadialCountdownRing } from './RadialCountdownRing';
import { useTranslation } from '@/i18n/useTranslation';

// Single shared 1Hz ticker for all TriggerCountdown instances. Prevents N setIntervals
// on pages with many triggers. Uses useSyncExternalStore so each component re-renders
// once per second without creating its own interval.
const tickSubscribers = new Set<() => void>();
let tickIntervalId: ReturnType<typeof setInterval> | null = null;
let tickValue = Date.now();

function subscribeTick(cb: () => void) {
  tickSubscribers.add(cb);
  if (tickIntervalId === null) {
    tickIntervalId = setInterval(() => {
      tickValue = Date.now();
      tickSubscribers.forEach((fn) => fn());
    }, 1000);
  }
  return () => {
    tickSubscribers.delete(cb);
    if (tickSubscribers.size === 0 && tickIntervalId !== null) {
      clearInterval(tickIntervalId);
      tickIntervalId = null;
    }
  };
}

function getTickSnapshot() {
  return tickValue;
}

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
  const now = useSyncExternalStore(subscribeTick, getTickSnapshot, getTickSnapshot);

  const nextMs = useMemo(() => getNextTriggerMs(trigger), [trigger]);
  const remaining = nextMs === null ? null : Math.floor((nextMs - now) / 1000);
  // Firing window: briefly show the fire state once we cross zero, until backend updates next_trigger_at
  const firing = remaining !== null && remaining <= 0 && remaining > -2;

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
