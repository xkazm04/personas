/**
 * The operator's console: run the instrument, and see what her loop is doing.
 *
 * ## What left, and what stayed
 *
 * The request COMPOSER - the skill picker, its argument field and its note
 * field - is gone from here. An app-wide universal console is being built to
 * take that job, and a second place to type a skill invocation would be a
 * second place for the two to drift. The lane it filed into left too, for the
 * queue DRAWER beside the docket, where it gets the height a queue deserves
 * instead of a 148px scroller wedged above the ledger.
 *
 * The RUN control stayed, and stays deliberately. It runs her projection, not
 * a skill - nothing in the universal console's job description covers it - and
 * without it this page has no way to populate itself at all, which would be a
 * regression rather than a simplification. When the universal console exists
 * and can carry it, moving it is one line.
 *
 * The runtime strip stayed because it is display, not input. The RUN SWITCH
 * arrived beside it in 2026-09: `curator_enabled` lived two navigations away on
 * her Setup page, so the one surface that draws what the switch does had no way
 * to move it. See `RunSwitch`, including why it does not use `set_app_setting`.
 *
 * ## The eleven seconds
 *
 * `curator_plan_refresh` spawns up to four node processes against the registry
 * on disk and takes about eleven seconds cold (five minutes cached on the same
 * HEAD). That is an ACTION the operator just pressed, not a surface loading
 * its data, so it wears a real spinner on the control itself plus `disabled`
 * and `aria-busy` - never a ghost, and never `LoadingSpinner`, which renders
 * nothing. Beside it, a live region says what is happening while the wait
 * runs, because eleven silent seconds on a button is indistinguishable from a
 * dead one.
 *
 * ## And what it says when the eleven seconds are over
 *
 * The wait was narrated and the ANSWER was not, which is the defect the
 * operator actually hit: he pressed the control twice against an unmoved
 * registry HEAD, got an identical projection both times, and had no way to tell
 * a working instrument from a dead button. So the same live region now reports
 * the outcome, in two parts, and both parts are measurements the backend took:
 *
 * - **whether the projection moved** - compared against the run this one
 *   superseded, which is the only comparison that answers the question. `null`
 *   is a third arm: the standing run could not be read, so whether anything
 *   moved is UNKNOWN and says so rather than defaulting to "unchanged".
 * - **where the reading came from** - a fresh walk of the corpus, or the
 *   five-minute cache against this commit. A two-second answer and an
 *   eleven-second answer are different events and the page must not hide which
 *   one it gave.
 *
 * It reuses the `aria-live` region rather than raising a toast: it is the
 * answer to something the operator pressed on this page, and it belongs where
 * the wait was narrated.
 */
import { RefreshCw } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';

import { useWords } from '../words';

import { RunSwitch } from './RunSwitch';
import { RuntimeStrip } from './RuntimeStrip';
import type { CuratorLoop } from './useCuratorLoop';

/** What the last run of the instrument did, as the backend measured it. */
export interface RefreshOutcome {
  /** `null` = the run it superseded could not be read, so this is UNKNOWN. */
  changed: boolean | null;
  /** True when the five-minute cache answered and no instrument ran. */
  fromCache: boolean;
}

export interface ConsoleProps {
  loop: CuratorLoop;
  policy: CuratorPolicy | null;
  refreshing: boolean;
  /** The last run's outcome, or `null` before the operator has run one. */
  outcome: RefreshOutcome | null;
  onRefresh: () => Promise<void>;
}

/**
 * The run control.
 *
 * THE PAGE HAS EXACTLY ONE, IN EVERY PHASE, AND IT IS HERE. It used to move:
 * with a projection the console carried it, and without one a whole-page empty
 * state did instead, which meant the control the operator is looking for
 * changed address depending on a read they cannot see. Now the full layout
 * always draws, so the console always has it - booting, offering and running
 * alike - and no phase can show the offer twice.
 */
function RunInstrument({
  refreshing,
  outcome,
  onRefresh,
}: {
  refreshing: boolean;
  outcome: RefreshOutcome | null;
  onRefresh: () => Promise<void>;
}) {
  const { w, tx } = useWords();
  // Three verdicts, and the third one is not a fallback: `changed === null`
  // means the comparison could not be made, which is a different thing to say
  // from "nothing moved" and must never be collapsed into it.
  const verdict =
    // Falsy rather than `=== null`: a caller that omits the prop entirely is a
    // type error, and a live region is not the place to find out about one.
    !outcome
      ? null
      : outcome.changed === null
        ? w.console.refresh_unknown
        : outcome.changed
          ? w.console.refresh_changed
          : w.console.refresh_same;
  const said =
    verdict === null
      ? ''
      : tx(verdict, {
          source: outcome?.fromCache ? w.console.refresh_cached : w.console.refresh_fresh,
        });
  return (
    <span className="cb-run">
      <AsyncButton
        variant="primary"
        size="sm"
        className="cb-keep"
        isLoading={refreshing}
        loadingText={w.console.refresh_running}
        icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden />}
        data-testid="curator-run-instrument"
        onClick={onRefresh}
      >
        {w.console.refresh}
      </AsyncButton>
      {/* The wait, and then the answer. `aria-live` because the only other
          signal that anything is happening is a spinner, which a screen reader
          does not read out. Clipped to one line by the stylesheet so this can
          never take a row off the ledger - the whole sentence stays in the tip,
          and the live region announces it whole whatever is on screen. */}
      <span
        className="cb-run-say typo-caption"
        role="status"
        aria-live="polite"
        data-role="cb-run-status"
        data-cb-tip={refreshing ? w.console.refresh_working : said}
      >
        {refreshing ? w.console.refresh_working : said}
      </span>
    </span>
  );
}

export function CuratorConsole({ loop, policy, refreshing, outcome, onRefresh }: ConsoleProps) {
  const { w } = useWords();
  return (
    <section className="cb-console" aria-label={w.console.region} data-role="cb-console">
      <div className="cb-console-top">
        <RunInstrument refreshing={refreshing} outcome={outcome} onRefresh={onRefresh} />
        {/* ONE flex item, not two. The switch is the control for the state the
            strip draws, so they read as one phrase - and, measured at 1000x640,
            two items here wrap the console row and every wrap of it costs a
            ledger row. */}
        <span className="cb-console-live">
          <RunSwitch />
          <RuntimeStrip runtime={loop.runtime} policy={policy} />
        </span>
      </div>
    </section>
  );
}
