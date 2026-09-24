import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoonStar } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { useAnchoredPortalPosition } from '@/features/shared/components/forms/useAnchoredPortalPosition';
import {
  companionGetSleepPressure,
  companionRunSleepCycle,
  type SleepPressure,
} from '@/api/companion';

const PANEL_WIDTH = 288;

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
 * A click no longer fires the cycle: it opens a small anchored confirmation
 * (the question, the current pressure / last-cycle line, Run + Cancel). Esc or
 * a press outside closes it. The panel is portalled so a clipping header or a
 * floating frame piece cannot cut it off.
 *
 * The component carries no environment gate itself — the call site in
 * `AthenaChatHeader` renders it behind `devModeAvailable`, the same debug-build
 * flag `DevConversationLogButton` sits behind.
 */
export function AthenaChatSleepButton() {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [pressure, setPressure] = useState<SleepPressure | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // One in-flight gauge read at a time. The tooltip fires on hover AND focus,
  // and a mouse crossing the button raises both.
  const fetching = useRef(false);
  const pos = useAnchoredPortalPosition(triggerRef, open, { flip: true, maxMenuHeight: 160, gap: 6 });

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
  useClickOutside([triggerRef, panelRef], open, close);
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      close();
      return true;
    },
    { enabled: open, priority: OVERLAY_DISMISS_PRIORITY },
  );

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

  const left = pos ? Math.max(8, Math.min(pos.left + pos.width - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8)) : 0;

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
          className={`p-1.5 rounded-interactive text-foreground hover:text-amber-400 hover:bg-amber-500/10 transition-colors focus-ring ${open ? 'text-amber-400 bg-amber-500/10' : ''}`}
          aria-label={label}
        >
          <MoonStar className="w-4 h-4" />
        </button>
      </Tooltip>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            data-testid="companion-sleep-confirm"
            style={{
              top: pos.flipUp ? undefined : pos.top,
              bottom: pos.flipUp ? window.innerHeight - pos.top : undefined,
              left,
              width: PANEL_WIDTH,
            }}
            className="fixed z-[9995] rounded-card border border-primary/15 bg-background shadow-elevation-4 p-3 space-y-3"
          >
            <div>
              <p className="typo-body text-foreground">{c.sleep_cycle_confirm}</p>
              {detail && <p className="typo-caption text-foreground/75 mt-1">{detail}</p>}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                {t.common.cancel}
              </Button>
              <AsyncButton
                variant="primary"
                size="sm"
                icon={<MoonStar className="w-3.5 h-3.5" />}
                onClick={onRun}
                data-testid="companion-sleep-confirm-run"
              >
                {c.sleep_cycle_confirm_run}
              </AsyncButton>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
