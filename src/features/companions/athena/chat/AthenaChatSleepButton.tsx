import { useCallback, useRef, useState } from 'react';
import { MoonStar } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  companionGetSleepPressure,
  companionRunSleepCycle,
  type SleepPressure,
} from '@/api/companion';

/**
 * Dev-only header button: force a sleep cycle now, and show what the
 * sleep-pressure gauge currently says.
 *
 * A cycle normally fires on accumulated conversation volume (40,000 chars) with
 * a 6h floor, so on a fresh install there may be nothing to watch for hours.
 * This is the affordance that lets the operator enforce a milestone cycle and
 * gather cycle data for the next waves — `force` bypasses pressure, the floor
 * and staleness, and cannot bypass the single-flight guard, so pressing it
 * while a cycle runs answers `skipped` rather than starting a second pass.
 *
 * The component carries no environment gate itself — the call site in
 * `AthenaChatHeader` renders it behind `devModeAvailable`, the same debug-build
 * flag `DevConversationLogButton` sits behind.
 */
export function AthenaChatSleepButton() {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [pressure, setPressure] = useState<SleepPressure | null>(null);
  // One in-flight gauge read at a time. The tooltip fires on hover AND focus,
  // and a mouse crossing the button raises both.
  const fetching = useRef(false);

  /**
   * Read the gauge lazily, on intent. Never awaited by the render path: the
   * header must paint whether or not this resolves, and a failed read simply
   * leaves the tooltip on its static label.
   */
  const loadPressure = useCallback(() => {
    if (fetching.current) return;
    fetching.current = true;
    companionGetSleepPressure()
      .then(setPressure)
      .catch(silentCatch('AthenaChatSleepButton:pressure'))
      .finally(() => {
        fetching.current = false;
      });
  }, []);

  const onForce = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const answer = await companionRunSleepCycle(true);
      if (answer.status === 'started' && answer.cycleId) {
        addToast(tx(c.sleep_cycle_started, { id: answer.cycleId }), 'success');
      } else {
        // A skip is a normal outcome, not a failure — `warning` is the store's
        // middle tone, so it neither claims success nor cries error. 15s
        // because the reason is a sentence carrying real numbers, not a word.
        addToast(
          tx(c.sleep_cycle_skipped, { reason: answer.skippedReason ?? '' }),
          'warning',
          15_000,
        );
      }
      // The press moved the gauge; re-read it so a second hover is not stale.
      loadPressure();
    } catch (e) {
      toastCatch('AthenaChatSleepButton', c.sleep_cycle_failed)(e);
    } finally {
      setBusy(false);
    }
  }, [busy, addToast, tx, c, loadPressure]);

  const label = c.sleep_cycle_force;
  const tip = pressure
    ? tx(c.sleep_cycle_pressure_tip, {
        chars: pressure.pressureChars.toLocaleString(),
        threshold: pressure.thresholdChars.toLocaleString(),
        last:
          pressure.lastCycle?.hoursAgo == null
            ? c.sleep_cycle_never
            : tx(c.sleep_cycle_hours_ago, { hours: pressure.lastCycle.hoursAgo }),
      })
    : label;

  return (
    <Tooltip content={tip} placement="bottom">
      <button
        type="button"
        onClick={() => void onForce()}
        onMouseEnter={loadPressure}
        onFocus={loadPressure}
        disabled={busy}
        data-testid="companion-force-sleep-cycle"
        className="p-1.5 rounded-interactive text-foreground hover:text-amber-400 hover:bg-amber-500/10 transition-colors focus-ring disabled:opacity-50"
        aria-label={label}
      >
        <MoonStar className="w-4 h-4" />
      </button>
    </Tooltip>
  );
}
