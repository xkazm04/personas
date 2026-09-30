/**
 * IS THE ECOSYSTEM GROWING? - the band that answers why any of this is worth
 * running, and therefore the one that goes first.
 *
 * Every other number she keeps is a RATE: dispatches, commits, spend, plan
 * items. All of them rise while she runs, whatever running achieves - which is
 * how eight refill passes against an already-full queue looked exactly like
 * eight passes of work. This band draws the ecosystem's SIZE instead, and the
 * difference between two samples of it.
 *
 * Three drawing rules, each carrying a fact the page refuses to blur:
 *
 * - **`unknown` is not `flat`.** One sample is not a trend, and the band says
 *   so in words rather than rendering a direction it cannot know.
 * - **`stale_verdicts` improves by FALLING.** The trend already accounts for it
 *   (`higherIsBetter` lives in the backend), so a `-247` on that metric wears
 *   the grew mark and not the shrank one. The raw change keeps its own sign,
 *   because hiding it would make the row unverifiable.
 * - **A metric nobody could read shows the ledger's own unknown mark**, never a
 *   zero and never an omission.
 */
import type { CuratorGrowthDelta } from '@/lib/bindings/CuratorGrowthDelta';
import type { CuratorGrowthReading } from '@/lib/bindings/CuratorGrowthReading';

import { useWords } from '../words';

/**
 * The change, with its sign kept.
 *
 * `bigint`, because the field is an `i64` on the wire: the metrics are `u32`
 * counts and their difference does not fit an `i32`. It is formatted as a bigint
 * rather than coerced through `Number`, which would be a silent precision claim
 * on a surface whose whole subject is not making those.
 */
function signed(n: bigint): string {
  return n > 0n ? `+${n.toString()}` : n.toString();
}

export function GrowthBand({ growth }: { growth: CuratorGrowthReading | null }) {
  const { w, tx } = useWords();
  const g = w.gaps;

  if (!growth) {
    return (
      <p className="cb-gap-unread typo-body" data-role="cb-gaps-growth-unread" data-cb-tip={g.unread_tip}>
        {g.unread}
      </p>
    );
  }

  // Fewer than two samples: there is nothing to subtract. Said in words,
  // because a verdict mark reading "unknown" beside seven empty metrics would
  // look like a broken instrument rather than a young one.
  if (growth.verdict === 'unknown' && growth.deltas.length === 0) {
    return (
      <p className="cb-gap-none typo-body" data-role="cb-gaps-growth-young">
        {growth.samples === 0 ? g.growth_no_samples : g.growth_one_sample}
      </p>
    );
  }

  const moved = growth.deltas.filter((d) => d.change !== null && d.change !== 0n);
  const unread = growth.deltas.filter((d) => d.change === null);

  return (
    <div data-role="cb-gaps-growth">
      <p className="cb-gap-verdict" data-verdict={growth.verdict} data-role="cb-gaps-verdict">
        <span className="cb-gap-mark" aria-hidden="true" />
        <b className="typo-title">{g.growth_verdict[growth.verdict]}</b>
        {/* The figure the owner actually asks for. Drawn only when it is
            non-zero: "moved nothing in 0 passes" is a sentence about nothing. */}
        {growth.flatStreak > 0 && (
          <i className="typo-caption cb-dim" data-role="cb-gaps-streak">
            {tx(g.growth_streak, { n: growth.flatStreak })}
          </i>
        )}
        <span className="cb-sp" />
        <i className="typo-caption cb-dim">{tx(g.growth_samples, { n: growth.samples })}</i>
      </p>
      {moved.length > 0 ? (
        <ul className="cb-gap-metrics" data-role="cb-gaps-metrics">
          {moved.map((d) => (
            <MetricChip key={d.metric} delta={d} />
          ))}
        </ul>
      ) : (
        <p className="cb-gap-none typo-caption" data-role="cb-gaps-metrics-flat">
          {g.growth_nothing_moved}
        </p>
      )}
      {/* The metrics neither sample could read. Named rather than dropped: a
          verdict computed over five readable metrics and two unreadable ones is
          a different claim from one computed over seven. */}
      {unread.length > 0 && (
        <p className="cb-gap-unread typo-caption" data-role="cb-gaps-metrics-unread">
          {tx(g.growth_unread_metrics, {
            metrics: unread.map((d) => g.metric[d.metric]).join(', '),
          })}
        </p>
      )}
    </div>
  );
}

function MetricChip({ delta }: { delta: CuratorGrowthDelta }) {
  const { w } = useWords();
  const g = w.gaps;
  return (
    <li className="cb-gap-metric typo-label" data-trend={delta.trend} data-role="cb-gaps-metric">
      <span className="cb-gap-metric-name">{g.metric[delta.metric]}</span>
      <b className="cb-gap-metric-n">{delta.change === null ? g.unknown_mark : signed(delta.change)}</b>
    </li>
  );
}
