/**
 * Her run switch, on the page where her work is drawn.
 *
 * ## Why it is here at all
 *
 * `curator_enabled` lived only on her Setup page, two navigations away from the
 * only surface that shows what the switch does. The operator could watch an
 * empty console and have no way to tell "she is off" from "she is on and has
 * nothing to say" without leaving the page to look.
 *
 * ## The same door, and it is NOT `set_app_setting`
 *
 * The brief for this work said to write through `set_app_setting`, "no second
 * setter". Measured: the Setup page does not use that door. It uses
 * [`useCompanionSwitch`], which calls the `companions_set_enabled` COMMAND, and
 * that command does three things a bare settings write does not:
 *
 * 1. refuses to switch a companion ON whose prerequisite is missing (Curator's
 *    is a mapped knowledge registry), and never refuses OFF;
 * 2. emits `companions://status-changed` with the whole category, which is what
 *    every other switch on screen re-paints from;
 * 3. since this change, emits `curator://pulse` too, so the strip beside this
 *    control shows the consequence rather than the intent.
 *
 * `curator_enabled` IS in `set_app_setting`'s allow-list, so writing it that way
 * would have compiled and persisted - and would have been the second setter the
 * instruction was trying to prevent, silently skipping all three. So this reuses
 * the hook the Setup page uses, and there is still exactly one door.
 *
 * ## What it claims, and what it refuses to claim
 *
 * ON means her loop may start work. OFF means it may not. **It does not mean
 * her terminals close** - a headless worker that is already running runs to its
 * end, and the tick that would have settled it returns early while she is off.
 *
 * That caveat is drawn by the strip this control sits in front of, not repeated
 * here: the strip already reads "switched off" and "terminals 2 of 2" side by
 * side, which is the whole fact, and a second count beside it would be a second
 * authority for one number. `RuntimeStrip` carries the sentence that explains
 * the pair.
 *
 * ## Why this is a bare toggle and not a toggle with a word beside it
 *
 * **Measured in a browser against the shot harness, 2026-09-25**, at the
 * 1000x640 this page is held to. Before this control existed the console row
 * was already EXACTLY full: the run control 182px, one 12.4px gap and the
 * runtime strip 781px, in a 975.25px content box. There was no slack to spend.
 *
 * A labelled switch is ~322px, and what it buys is not a wrapped row - it is
 * LEDGER ROWS: measured, a labelled switch took the visible rows from 10 to 9,
 * and a labelled switch plus the run's verdict took them to 7. A bare 33px
 * toggle costs nothing at 1100px and above, and nothing at 1000px either unless
 * the strip is in its widest form (`fannedOut` UNKNOWN, which is the reading
 * only while she holds a terminal), where it costs one row.
 *
 * The words are not lost. The strip immediately to the right of this toggle
 * says "serving your queue" or "switched off", so the state is already drawn in
 * prose and this is the control for it - one authority, not two.
 *
 * The one thing that DOES take the row unconditionally is the locked state's
 * missing prerequisite, and that is deliberate: it appears only when no
 * knowledge registry is mapped, which is also a state in which there is no
 * projection on the page to push off the screen.
 */
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';

import { useCompanionSwitch } from '../../../status/useCompanionSwitch';
import { useWords } from '../words';

export function RunSwitch() {
  const { w } = useWords();
  const { status, loading, locked, prerequisite, toggle } = useCompanionSwitch('curator');

  // The status door is the switch's own authority: it is what the write returns
  // and what the category event re-paints from. `null` is UNREAD, not off - so
  // the control says it is unread rather than sitting in a position nobody
  // measured.
  const unread = !status;
  const on = status?.enabled ?? false;

  return (
    <span className="cb-switch" data-role="cb-switch" data-state={unread ? 'unread' : on ? 'on' : 'off'}>
      <span
        className="cb-switch-hold"
        data-cb-tip={unread ? w.console.switch_unread_tip : w.console.switch_tip}
      >
        <AccessibleToggle
          className="cb-keep"
          size="sm"
          checked={on}
          disabled={loading || locked}
          onChange={() => void toggle()}
          // The accessible name says which way pressing it goes, and the unread
          // arm says the switch could not be read rather than naming a move
          // this app cannot promise.
          label={unread ? w.console.switch_unread : on ? w.console.switch_label_off : w.console.switch_label_on}
          data-testid="curator-run-switch"
        />
      </span>
      {/* Locked is not broken: the control names what is missing. The only
          state that takes width from the strip, and it is a state with no
          projection on the page to lose. */}
      {prerequisite && (
        <span className="cb-switch-note typo-caption" data-role="cb-switch-locked">
          {prerequisite}
        </span>
      )}
    </span>
  );
}
