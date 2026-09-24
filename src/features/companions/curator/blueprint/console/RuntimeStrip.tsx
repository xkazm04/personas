/**
 * What her loop is doing, and every brake on it.
 *
 * Two rules hold this strip together and both are rules about absence:
 *
 * 1. **`fannedOut` is nullable and never renders as 0.** A dispatcher skill
 *    spawns its own pool - `librarian` and `forge` cap at 10, `harvest` at 5,
 *    `hygiene` at 6 - so a worker cap of 2 is not a cap of 2 processes. When
 *    she cannot see inside a worker the strip says UNKNOWN.
 * 2. **A cap is drawn even when today's consumption is 0.** `0 of 20` is the
 *    reading that tells the operator a brake exists and has room; a meter that
 *    hid itself until something was spent would hide the brake as well.
 *
 * The ceiling comes from `CuratorPolicy` when that door answered, because the
 * policy is the OPERATOR'S declaration and carries an undeclared cap as null -
 * a fact the runtime's plain `number` cannot express. The runtime's own figure
 * is the fallback for when the policy read failed.
 */
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';
import type { CuratorRuntime } from '@/lib/bindings/CuratorRuntime';

import { fmt, usd } from '../format';
import { useWords } from '../words';

/** The four lanes `CuratorRuntime.lane` names. Anything else is unnamed here. */
const LANES = ['queue', 'plan', 'refill', 'sleep'] as const;
type Lane = (typeof LANES)[number];

function isLane(value: string): value is Lane {
  return (LANES as readonly string[]).includes(value);
}

/**
 * One brake: what has been used today, against the ceiling declared for it.
 *
 * `cap === null` is the undeclared arm and renders the operator's own words
 * rather than a number - never `0`, which would read as a companion that may
 * never run.
 */
function Brake({ label, used, cap, absent, tip }: {
  label: string;
  used: string;
  cap: string | null;
  absent: string;
  tip: string;
}) {
  const { w, tx } = useWords();
  return (
    <span className="cb-brake" data-cb-tip={tip} data-role="cb-brake">
      {label}{' '}
      {cap === null ? (
        <b data-role="cb-brake-value">
          {used} <i className="cb-unset">{absent}</i>
        </b>
      ) : (
        <b data-role="cb-brake-value">{tx(w.console.used_of, { used, cap })}</b>
      )}
    </span>
  );
}

export function RuntimeStrip({ runtime, policy }: {
  runtime: CuratorRuntime | null;
  policy: CuratorPolicy | null;
}) {
  const { w, tx } = useWords();

  // The runtime door did not answer. Nothing below is zero - it is unread, and
  // the strip says which of the two it is rather than drawing a quiet loop.
  if (!runtime) {
    return (
      <div className="cb-runtime typo-caption" data-role="cb-runtime" data-state="unread">
        <span className="cb-unset" data-cb-tip={w.console.runtime_unread_tip}>
          {w.console.runtime_unread}
        </span>
      </div>
    );
  }

  const lane = isLane(runtime.lane) ? w.console.lane[runtime.lane] : w.console.lane_unnamed;
  // The declared ceiling is the operator's, and `null` there means "none
  // declared". Only when that read failed does the runtime's own number stand.
  const cap = (declared: number | null, live: number) => (policy ? declared : live);
  const budget = cap(policy?.dailyBudgetUsd ?? null, runtime.dailyBudgetUsd);
  const runs = cap(policy?.dailyRunCap ?? null, runtime.dailyRunCap);
  const commits = cap(policy?.dailyCommitCap ?? null, runtime.dailyCommitCap);

  return (
    <div className="cb-runtime typo-caption" data-role="cb-runtime" data-state={runtime.enabled ? 'on' : 'off'}>
      <span className={`cb-serving${runtime.enabled ? '' : ' cb-unset'}`} data-role="cb-serving">
        <i className="cb-dot" aria-hidden />
        {runtime.enabled ? tx(w.console.serving, { lane }) : w.console.runtime_off}
      </span>
      {runtime.haltedReason && (
        <span className="cb-halted" data-role="cb-halted">
          {tx(w.console.halted, { why: runtime.haltedReason })}
        </span>
      )}
      <span data-cb-tip={tx(w.console.terminals_tip, { running: fmt(runtime.running), cap: fmt(runtime.workerCap) })}>
        {w.console.terminals} <b>{tx(w.console.used_of, { used: fmt(runtime.running), cap: fmt(runtime.workerCap) })}</b>
      </span>
      {/* Rule 1. The null arm carries no digit at all, so there is nothing on
          screen for a reader to mistake for a measured count of none. */}
      <span
        data-role="cb-fanned"
        data-known={runtime.fannedOut === null ? 'false' : 'true'}
        data-cb-tip={tx(
          runtime.fannedOut === null ? w.console.fanned_unknown_tip : w.console.fanned_tip,
          { cap: fmt(runtime.workerCap) },
        )}
      >
        {w.console.fanned}{' '}
        {runtime.fannedOut === null ? (
          <b className="cb-unset">{w.console.fanned_unknown}</b>
        ) : (
          <b>{fmt(runtime.fannedOut)}</b>
        )}
      </span>
      <span className="cb-sp" />
      <Brake
        label={w.gauge_budget}
        used={usd(runtime.spentTodayUsd)}
        cap={budget === null ? null : usd(budget)}
        absent={w.gauge_no_cap}
        tip={w.console.brake_tip}
      />
      <Brake
        label={w.gauge_runs}
        used={fmt(runtime.runsToday)}
        cap={runs === null ? null : fmt(runs)}
        absent={w.gauge_no_cap}
        tip={w.console.brake_tip}
      />
      <Brake
        label={w.gauge_commits}
        used={fmt(runtime.commitsToday)}
        cap={commits === null ? null : fmt(commits)}
        absent={w.gauge_no_cap}
        tip={w.console.brake_tip}
      />
    </div>
  );
}
