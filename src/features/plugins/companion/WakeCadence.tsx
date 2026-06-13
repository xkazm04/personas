// Autonomy cadence strip (docs/plans/athena-wake-window.md) — visible while
// autonomous mode is ON: pick the wake window (signals accumulate and Athena
// handles them in batches once they're stale enough) and see what autonomy
// actually did in the last 24 h. Priority signals (blocked teams, urgent
// messages) bypass the window — the timer never delays an unblock.
import { useCallback, useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { silentCatch } from '@/lib/silentCatch';

interface SurfaceStats {
  surface: string;
  wakes: number;
  signals: number;
  cli_calls: number;
  actions: number;
}

interface WakeStats {
  window_minutes: number;
  surfaces: SurfaceStats[];
}

const WINDOW_CHOICES = [0, 30, 60, 120] as const;

export function WakeCadence() {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const [stats, setStats] = useState<WakeStats | null>(null);

  const refresh = useCallback(() => {
    invokeWithTimeout<WakeStats>('companion_wake_stats', {})
      .then(setStats)
      .catch(silentCatch('companion_wake_stats'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setWindow = (minutes: number) => {
    invokeWithTimeout('set_app_setting', {
      key: 'athena_wake_window_minutes',
      value: String(minutes),
    })
      .then(refresh)
      .catch(silentCatch('set_wake_window'));
  };

  const totals = (stats?.surfaces ?? []).reduce(
    (acc, s) => ({
      wakes: acc.wakes + s.wakes,
      signals: acc.signals + s.signals,
      calls: acc.calls + s.cli_calls,
      actions: acc.actions + s.actions,
    }),
    { wakes: 0, signals: 0, calls: 0, actions: 0 },
  );

  const labelFor = (m: number) =>
    m === 0 ? c.wake_reactive : m === 30 ? c.wake_30 : m === 60 ? c.wake_60 : c.wake_120;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/10 bg-primary/[0.03]"
      data-testid="companion-wake-cadence"
    >
      <Tooltip content={c.wake_cadence_hint}>
        <span className="flex items-center gap-1 typo-caption text-foreground/80 flex-shrink-0">
          <Timer className="w-3 h-3" aria-hidden />
          {c.wake_cadence_label}
        </span>
      </Tooltip>
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label={c.wake_cadence_label}>
        {WINDOW_CHOICES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={stats?.window_minutes === m}
            onClick={() => setWindow(m)}
            className={`px-1.5 py-0.5 rounded-interactive typo-caption transition-colors focus-ring ${
              stats?.window_minutes === m
                ? 'bg-primary/15 text-primary'
                : 'text-foreground/70 hover:bg-secondary/40'
            }`}
            data-testid={`wake-window-${m}`}
          >
            {labelFor(m)}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      {stats && totals.wakes > 0 && (
        <span className="typo-caption text-foreground/70 tabular-nums truncate">
          {tx(c.wake_impact_line, {
            wakes: totals.wakes,
            signals: totals.signals,
            calls: totals.calls,
            actions: totals.actions,
          })}
        </span>
      )}
    </div>
  );
}
