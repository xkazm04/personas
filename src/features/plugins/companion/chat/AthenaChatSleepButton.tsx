import { useCallback, useRef, useState } from 'react';
import { MoonStar } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ConfirmPopover } from '@/features/shared/components/feedback/ConfirmPopover';
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
 * A click no longer fires the cycle: it opens the shared `ConfirmPopover`
 * (the question, the current pressure / last-cycle line, Run + Cancel), the
 * same confirmation the Reset key uses. Esc or a press outside closes it.
 *
 * The component carries no environment gate itself — the call site in
 * `AthenaChatHeader` renders it behind `devModeAvailable`, the same debug-build
 * flag `DevConversationLogButton` sits behind.
 */
export function AthenaChatSleepButton({
  className,
  activeClassName = '',
  iconClassName = 'w-4 h-4',
}: {
  /** The host header's key shape. Defaults to the Current header's amber dev key. */
  className?: string;
  activeClassName?: string;
  iconClassName?: string;
} = {}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [pressure, setPressure] = useState<SleepPressure | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // One in-flight gauge read at a time. The tooltip fires on hover AND focus,
  // and a mouse crossing the button raises both.
  const fetching = useRef(false);

  /**
   * Read the gauge lazily, on intent. Never awaited by the render path: the
   * header must paint whether or not this resolves, and a failed read simply
   * leaves the detail line out.
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

  const close = useCallback(() => setOpen(false), []);

  const onRun = useCallback(async () => {
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
      setOpen(false);
      // The press moved the gauge; re-read it so the next look is not stale.
      loadPressure();
    } catch (e) {
      toastCatch('AthenaChatSleepButton', c.sleep_cycle_failed)(e);
    }
  }, [addToast, tx, c, loadPressure]);

  const label = c.sleep_cycle_force;
  const detail = pressure
    ? tx(c.sleep_cycle_pressure_tip, {
        chars: pressure.pressureChars.toLocaleString(),
        threshold: pressure.thresholdChars.toLocaleString(),
        last:
          pressure.lastCycle?.hoursAgo == null
            ? c.sleep_cycle_never
            : tx(c.sleep_cycle_hours_ago, { hours: pressure.lastCycle.hoursAgo }),
      })
    : null;

  return (
    <>
      {/* While the confirmation is open it owns the space below the key, so
          the hover tip moves above it instead of covering the question. */}
      <Tooltip content={detail ?? label} placement={open ? 'top' : 'bottom'}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            if (!open) loadPressure();
            setOpen((v) => !v);
          }}
          onMouseEnter={loadPressure}
          onFocus={loadPressure}
          data-testid="companion-force-sleep-cycle"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={
            className
              ? `grid place-items-center shrink-0 transition-colors focus-ring ${className} ${open ? activeClassName : ''}`
              : `p-1.5 rounded-interactive text-foreground hover:text-amber-400 hover:bg-amber-500/10 transition-colors focus-ring ${open ? 'text-amber-400 bg-amber-500/10' : ''}`
          }
          aria-label={label}
        >
          <MoonStar className={iconClassName} />
        </button>
      </Tooltip>
      <ConfirmPopover
        open={open}
        anchorRef={triggerRef}
        title={c.sleep_cycle_confirm}
        detail={detail}
        confirmLabel={c.sleep_cycle_confirm_run}
        confirmIcon={<MoonStar className="w-3.5 h-3.5" />}
        onConfirm={onRun}
        onCancel={close}
        testId="companion-sleep-confirm"
        confirmTestId="companion-sleep-confirm-run"
      />
    </>
  );
}
