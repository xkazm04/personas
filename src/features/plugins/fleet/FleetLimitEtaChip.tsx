import { Hourglass } from 'lucide-react';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useNowTick } from './relativeAgo';

/**
 * Countdown chip for a session parked on a Claude usage/session limit.
 *
 * The backend parses the reset time straight off the limit banner (`resets
 * 7:50pm`) and stamps it on the session, so instead of watching blind retries
 * cycle for hours the operator sees exactly when the fleet comes back. Absent
 * (`null`) means either no limit is parked or the banner didn't state a
 * parseable time — in which case the retry lane keeps its blind cadence and
 * there is honestly nothing to show, so the chip renders nothing.
 */

/** Local wall-clock label for the reset moment ("19:50"). */
export function formatResetClock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Coarse "how long until" label — minutes below an hour, then hours. */
export function formatUntil(t: Translations, atMs: number, now: number): string {
  const mins = Math.max(0, Math.round((atMs - now) / 60_000));
  if (mins < 60) return interpolate(t.plugins.fleet.limit_eta_in_minutes, { n: mins });
  return interpolate(t.plugins.fleet.limit_eta_in_hours, { n: Math.round(mins / 60) });
}

interface FleetLimitEtaChipProps {
  /** `session.limitResetAtMs` — already guaranteed to be in the future. */
  limitResetAtMs: bigint | number | null;
  /** `compact` drops the "in 42m" suffix (tight tile / footer rows). */
  compact?: boolean;
  testId?: string;
}

export function FleetLimitEtaChip({
  limitResetAtMs,
  compact = false,
  testId = 'fleet-limit-eta',
}: FleetLimitEtaChipProps) {
  const { t } = useTranslation();
  const now = useNowTick();
  if (limitResetAtMs == null) return null;
  const at = Number(limitResetAtMs);
  if (!Number.isFinite(at) || at <= now) return null;

  const clock = formatResetClock(at);
  const label = interpolate(t.plugins.fleet.limit_eta_resumes, { time: clock });

  return (
    <Tooltip content={interpolate(t.plugins.fleet.limit_eta_tooltip, { time: clock })}>
      <span
        data-testid={testId}
        className="inline-flex items-center gap-1 rounded-interactive border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 typo-caption tabular-nums text-amber-300"
      >
        <Hourglass className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
        <span>{label}</span>
        {!compact && <span className="opacity-70">{formatUntil(t, at, now)}</span>}
      </span>
    </Tooltip>
  );
}
