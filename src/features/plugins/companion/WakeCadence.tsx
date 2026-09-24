// Autonomy cadence (docs/plans/athena-wake-window.md) — lives inside the
// autonomy options popup (`AthenaAutonomyOption`): pick the wake window
// (signals accumulate and Athena handles them in batches once they're stale
// enough) and see what autonomy actually did in the last 24 h. Priority
// signals (blocked teams, urgent messages) bypass the window — the timer never
// delays an unblock.
import { useCallback, useEffect, useState } from 'react';
import {
  companionWakeStats,
  type CompanionWakeStats as WakeStats,
} from '@/api/companion/bridges';
import { setAppSetting } from '@/api/system/settings';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { ChoiceRow } from './AutonomyChoiceRow';

const WINDOW_CHOICES = [0, 30, 60, 120] as const;

export interface WakeCadenceState {
  stats: WakeStats | null;
  windowMinutes: number | null;
  setWindow: (minutes: number) => void;
  labelFor: (minutes: number) => string;
}

/** The wake window and its 24 h impact. Reads once when `enabled` turns on. */
export function useWakeCadence(enabled = true): WakeCadenceState {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [stats, setStats] = useState<WakeStats | null>(null);

  const refresh = useCallback(() => {
    companionWakeStats()
      .then(setStats)
      .catch(silentCatch('companion_wake_stats'));
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  const setWindow = useCallback(
    (minutes: number) => {
      // Optimistic, so the choice lights up before the round trip.
      setStats((s) => (s ? { ...s, windowMinutes: minutes } : s));
      setAppSetting('athena_wake_window_minutes', String(minutes))
        .then(refresh)
        .catch(silentCatch('set_wake_window'));
    },
    [refresh],
  );

  const labelFor = useCallback(
    (m: number) => (m === 0 ? c.wake_reactive : m === 30 ? c.wake_30 : m === 60 ? c.wake_60 : c.wake_120),
    [c],
  );

  return { stats, windowMinutes: stats?.windowMinutes ?? null, setWindow, labelFor };
}

export function WakeCadence({ cadence, disabled = false }: { cadence: WakeCadenceState; disabled?: boolean }) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const { stats, windowMinutes, setWindow, labelFor } = cadence;

  const totals = (stats?.surfaces ?? []).reduce(
    (acc, s) => ({
      wakes: acc.wakes + s.wakes,
      signals: acc.signals + s.signals,
      calls: acc.calls + s.cliCalls,
      actions: acc.actions + s.actions,
    }),
    { wakes: 0, signals: 0, calls: 0, actions: 0 },
  );

  return (
    <div className="flex flex-col gap-2" data-testid="companion-wake-cadence">
      <p className="typo-caption text-foreground">{c.wake_cadence_hint}</p>
      <ChoiceRow
        label={c.wake_cadence_label}
        choices={WINDOW_CHOICES.map((m) => ({ id: String(m), label: labelFor(m), testId: `wake-window-${m}` }))}
        value={windowMinutes === null ? null : String(windowMinutes)}
        onChoose={(id) => setWindow(Number(id))}
        disabled={disabled}
      />
      {stats && totals.wakes > 0 && (
        <p className="typo-caption text-foreground tabular-nums">
          {tx(c.wake_impact_line, {
            wakes: totals.wakes,
            signals: totals.signals,
            calls: totals.calls,
            actions: totals.actions,
          })}
        </p>
      )}
    </div>
  );
}
