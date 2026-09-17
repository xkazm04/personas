// MaxParallelStepper — the fleet's cap, on the board that shows its effect.
//
// A compact `running / cap` readout with a − and a + that write
// `fleet.max_parallel_sessions` straight away — no Set button, unlike the
// Limits page's `BoundRow` for the same key, because on the board the
// operator is watching the queue react and a held value would be a value the
// door does not have. The bounds are the same object (`autopilotBounds.ts`),
// so the two controls cannot disagree about the range. Over-admission is
// painted as `11 / 10` in the warning tone: the number is true and the line
// is crossed, and the board should say both.

import { useCallback } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppSetting } from '@/hooks/utility/data/useAppSetting';
import { setAppSetting } from '@/api/system/settings';
import { toastCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { clampToBound, FLEET_MAX_PARALLEL_SESSIONS_BOUNDS, isWithin } from '@/features/settings/sub_limits/autopilotBounds';

const BOUND = FLEET_MAX_PARALLEL_SESSIONS_BOUNDS;

export function MaxParallelStepper({
  running, overAdmitted, disabled = false,
}: {
  /** Live sessions counted by the door (`FleetQueueSnapshot.running`). */
  running: number;
  /** `max(0, running − cap)` from the same snapshot. */
  overAdmitted: number;
  /** A simulated board writes nothing. */
  disabled?: boolean;
}) {
  const { t, tx } = useTranslation();
  const s = t.monitor;
  const setting = useAppSetting(BOUND.key, String(BOUND.defaultValue), (v) => isWithin(BOUND, v));
  const cap = clampToBound(BOUND, Number(setting.value));

  const write = useCallback(
    (next: number) => {
      const v = clampToBound(BOUND, next);
      if (v === cap) return;
      // Painted first, written second: the − / + are the operator's own act
      // and the door announces `cap_changed` on its side, which re-reads the
      // snapshot. A failed write toasts and snaps the readout back.
      const prev = setting.value;
      setting.setValue(String(v));
      setAppSetting(BOUND.key, String(v)).catch((err: unknown) => {
        setting.setValue(prev);
        toastCatch('fleet/MaxParallelStepper:write', s.queue_action_failed)(err);
      });
    },
    [cap, setting, s.queue_action_failed],
  );

  const over = overAdmitted > 0;
  const hint = over
    ? tx(s.queue_cap_over_hint, { running, cap, over: overAdmitted })
    : tx(s.queue_cap_hint, { running, cap });
  const btn = 'focus-ring flex h-5 w-5 items-center justify-center rounded-interactive text-foreground opacity-70 transition-colors hover:bg-secondary/40 hover:opacity-100 disabled:opacity-25 disabled:hover:bg-transparent';
  const canEdit = setting.loaded && !disabled;

  return (
    <Tooltip content={hint}>
      <div
        className={`inline-flex h-6 items-center gap-0.5 rounded-full border px-1 ${
          over ? 'border-status-warning/50 bg-status-warning/10' : 'border-border bg-secondary/20'
        }`}
        role="group"
        aria-label={s.queue_cap_aria}
        data-testid="fleet-max-parallel"
        data-over={over || undefined}
      >
        <button type="button" className={btn} onClick={() => write(cap - 1)} disabled={!canEdit || cap <= BOUND.min} aria-label={s.queue_cap_decrease}>
          <Minus className="h-3 w-3" aria-hidden />
        </button>
        <span className={`px-0.5 typo-caption tabular-nums ${over ? 'text-status-warning font-semibold' : 'text-foreground'}`} data-testid="fleet-max-parallel-readout">
          <Numeric value={running} /> / <Numeric value={cap} />
        </span>
        <button type="button" className={btn} onClick={() => write(cap + 1)} disabled={!canEdit || cap >= BOUND.max} aria-label={s.queue_cap_increase}>
          <Plus className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </Tooltip>
  );
}

export default MaxParallelStepper;
