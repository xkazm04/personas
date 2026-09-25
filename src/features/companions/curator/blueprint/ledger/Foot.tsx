/**
 * The gauges.
 *
 * The legend that named the nine channels and the three empty inks was removed
 * on the operator's instruction (2026-09-24). The inks still carry their own
 * tooltips at every cell, so the fact is on demand rather than standing; the
 * `legend_*` keys are deliberately left in the locales, because taking them out
 * across fourteen files would be the expensive half of a decision that may yet
 * be reversed.
 *
 * The gauges show the operator's DECLARED ceilings, read LIVE from
 * `curator_policy_get`. `CuratorPolicy` carries the caps as `Option`, and an
 * unset cap is not a cap of zero: where none is declared the gauge says so
 * rather than drawing a companion that may never run. Today's spend and
 * today's run count are not in the projection, so they are not drawn - the
 * page never paints a figure the instrument did not carry.
 *
 * Where the live setting disagrees with the one the PLAN carries, the gauge
 * says which value the plan was made under. The plan is what a person agreed
 * to; silently showing only today's number would erase that.
 */
import type { BlueprintModel } from '../model/types';
import { fmt, usd } from '../format';
import { useWords } from '../words';

import { Unmeasured } from './Unmeasured';

/**
 * One declared ceiling.
 *
 * `value` is NULLABLE on purpose, and the null arm is the whole point: an
 * undeclared cap is not a cap of zero and not an empty tile. The gauge renders
 * the words the operator would recognise ("no cap declared") and says why in
 * the tip, so absence can never be read as a limit of nothing.
 *
 * `unknown` is a THIRD state and not the same as the second: nobody has read
 * the settings at all, so "no cap declared" would itself be a claim. It wears
 * the ledger's unknown ink instead.
 */
function Cap({
  label,
  value,
  absent,
  tip,
  drifted,
  unknown,
}: {
  label: string;
  value: string | null;
  absent: string;
  tip?: string;
  drifted?: string;
  unknown?: boolean;
}) {
  return (
    <span data-cb-tip={unknown ? undefined : (drifted ?? tip)}>
      {label}{' '}
      {unknown ? <Unmeasured /> : value === null ? <b className="cb-unset">{absent}</b> : <b>{value}</b>}
      {!unknown && drifted && <i className="cb-drift">{'≠'}</i>}
    </span>
  );
}

export function Foot({ model, waiting }: { model: BlueprintModel; waiting: number }) {
  const { w, tx } = useWords();
  // The live read when it answered, and the plan's own copy when it did not.
  // Both absent means no settings have been read at all, which is a different
  // thing from settings that declare no cap - so every gauge goes unknown.
  const p = model.livePolicy ?? model.policy;
  const unknown = p === null;
  const none = w.gauge_no_cap;
  const was = (field: 'dailyBudgetUsd' | 'dailyRunCap' | 'dailyCommitCap' | 'quietHours' | 'workerCap') =>
    model.policyDrift.includes(field)
      ? tx(w.gauge_drifted, { was: String(model.policy?.[field] ?? none) })
      : undefined;

  return (
    <footer className="cb-foot">
      <div className="cb-gauge typo-caption">
        {/* The queue depth is real, but a depth without the ceiling it is
            measured against says nothing - so the pair goes unknown together
            rather than drawing a 0 beside an absent limit. */}
        {p ? (
          <span data-cb-tip={tx(w.gauge_backpressure_tip, { n: p.backpressureN })}>
            {w.gauge_backpressure} <b>{`${String(waiting)}/${String(p.backpressureN)}`}</b>
          </span>
        ) : (
          <span>
            {w.gauge_backpressure} <Unmeasured />
          </span>
        )}
        <Cap
          label={w.gauge_budget}
          value={p?.dailyBudgetUsd == null ? null : usd(p.dailyBudgetUsd)}
          absent={none}
          tip={w.gauge_no_cap_tip}
          drifted={was('dailyBudgetUsd')}
          unknown={unknown}
        />
        <Cap
          label={w.gauge_runs}
          value={p?.dailyRunCap == null ? null : fmt(p.dailyRunCap)}
          absent={none}
          tip={w.gauge_no_cap_tip}
          drifted={was('dailyRunCap')}
          unknown={unknown}
        />
        <Cap
          label={w.gauge_commits}
          value={p?.dailyCommitCap == null ? null : fmt(p.dailyCommitCap)}
          absent={none}
          tip={w.gauge_no_cap_tip}
          drifted={was('dailyCommitCap')}
          unknown={unknown}
        />
        <Cap
          label={w.gauge_workers}
          value={p ? fmt(p.workerCap) : null}
          absent={none}
          drifted={was('workerCap')}
          unknown={unknown}
        />
        <Cap
          label={w.gauge_quiet_hours}
          value={p?.quietHours ?? null}
          absent={none}
          tip={w.gauge_no_cap_tip}
          drifted={was('quietHours')}
          unknown={unknown}
        />
        {!model.livePolicy && <span data-cb-tip={w.gauge_policy_unread_tip}>{w.gauge_policy_unread}</span>}
      </div>
    </footer>
  );
}
