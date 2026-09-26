/**
 * ONE RUN THAT STOPPED REPORTING.
 *
 * The row the operator was missing. They saw these as a fleet of stale terminals
 * before any surface named them, and the only way to learn why was to open the
 * database - where all 18 turned out to carry the same sentence, `No log growth
 * for 6 min`, several of them marked `restored after restart`.
 *
 * **The fleet's reason travels verbatim.** It is not summarised into a status,
 * because the sentence is the evidence: the staleness rule is fleet-wide and its
 * own doc says it assumes "the user walked away or the session hung". Her
 * workers are headless, so there is no user to walk away, and a research pass
 * thinks for longer than six minutes without writing a line. A reader who can
 * see the reason can tell a hung worker from a tracker that gave up on a healthy
 * one; a reader shown only "stale" cannot.
 *
 * `settled` is the second reading and a different fact: her ledger may have
 * tidily recorded an outcome for a run whose outcome nobody knows.
 */
import type { CuratorQuietRun } from '@/lib/bindings/CuratorQuietRun';

import { utcStamp } from '../format';
import { useWords } from '../words';

export function QuietRow({ run }: { run: CuratorQuietRun }) {
  const { w, tx } = useWords();
  const g = w.gaps;
  return (
    <li
      className="cb-gap-row cb-gap-quiet"
      data-role="cb-gaps-quiet"
      data-state={run.state}
      data-settled={run.settled ? 'yes' : 'no'}
      data-cb-id={run.sessionId}
    >
      <span className="cb-gap-owner typo-label" data-role="cb-gaps-quiet-state">
        {run.state}
      </span>
      <span className="cb-gap-what">
        {/* Named by the WORK, from her dispatch row - not by a terminal title,
            which the fleet's naming lane rewrites. A session with no dispatch
            row behind it says so rather than borrowing a name. */}
        {run.skill ? (
          <>
            <b>/{run.skill}</b>
            {run.argument && <i className="cb-req-arg">{run.argument}</i>}
          </>
        ) : (
          <i className="cb-unset" data-cb-tip={g.quiet_unlinked_tip}>
            {g.quiet_unlinked}
          </i>
        )}
      </span>
      <span className="cb-sp" />
      {/* `null` minutes is unknown, never zero: a row claiming "quiet 0m" would
          read as a session active this second, which is the opposite of why it
          is in this list. */}
      <span className="cb-gap-n typo-label" data-role="cb-gaps-quiet-for">
        {run.quietMinutes === null ? g.unknown_mark : tx(g.quiet_for, { n: run.quietMinutes })}
      </span>
      {!run.settled && (
        <span className="cb-gap-leak typo-label" data-role="cb-gaps-leak" data-cb-tip={g.quiet_unsettled_tip}>
          {g.quiet_unsettled}
        </span>
      )}
      {run.reason && (
        <span className="cb-gap-why typo-caption" data-role="cb-gaps-quiet-why">
          {run.reason}
        </span>
      )}
      {run.startedAt && (
        <span className="cb-gap-when typo-caption cb-dim">{utcStamp(run.startedAt)}</span>
      )}
    </li>
  );
}
