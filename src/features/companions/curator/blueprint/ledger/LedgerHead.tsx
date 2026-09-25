/**
 * The sticky head: the group labels, then the nine icon column heads.
 *
 * The head is a `.cb-lrow` like every other row and carries the same
 * `cb-ledger-row` / `cb-ledger-total` hooks the data rows do - which is what
 * the winner's own selectors did (`#lscroll .lrow:not(.band)` matched the head
 * first), so the contract compares the same element on both sides.
 *
 * It draws BEFORE anything has been measured too, which is the whole reason
 * the page can render itself empty: the nine channels are a closed vocabulary,
 * not a result, so their heads are known before any instrument runs. Only the
 * counts under them are unknown, and those wear the ledger's own unknown ink.
 */
import { Fragment } from 'react';

import { channelColour, CHANNEL_ORDER, CHANNELS, type ChannelId } from '../model/channels';
import type { BlueprintModel, ChannelTotal } from '../model/types';
import { fmt, say } from '../format';
import { useWords } from '../words';

import { Unmeasured } from './Unmeasured';

interface HeadProps {
  model: BlueprintModel;
  solo: ChannelId | 0;
  onSolo: (channel: ChannelId) => void;
}

/**
 * The head is TWO rows, not three.
 *
 * It used to carry a third line of standing gloss - nine "6 each / 5 each / 4"
 * weight captions under the column heads, and two sentences explaining the
 * group names ("present, or measured absent", "each carries its own value").
 * All of it was redundant with the tip each head already carries verbatim, the
 * group sentences clipped mid-word at every width the group is narrower than
 * its own prose ("each carries its own valu"), and the three lines cost 30 of
 * the head's 116px on a page whose measured defect is that at 1000x640 the
 * chrome takes 100.5% of the viewport and NOT ONE of sixteen rows is visible.
 * The `group_*_gloss` and `weight_each` keys stay in the fourteen locales:
 * removing a string is cheaper to reverse than re-translating one.
 */

function weightLabel(
  id: ChannelId,
  w: ReturnType<typeof useWords>['w'],
  tx: ReturnType<typeof useWords>['tx'],
): string {
  const spec = CHANNELS.find((c) => c.id === id)!;
  return spec.multiplied ? tx(w.weight_each, { n: spec.weight }) : String(spec.weight);
}

function ChannelHead({ model, id, solo, onSolo }: HeadProps & { id: ChannelId }) {
  const { w, tx } = useWords();
  const spec = CHANNELS.find((c) => c.id === id)!;
  const total: ChannelTotal = model.totals[id];
  const name = w.channel[`c${String(id)}` as keyof typeof w.channel];
  const weight = weightLabel(id, w, tx);
  // Three states, not two. A column that has never been measured is neither
  // scoring nor a zero, and it must not borrow the zero's sentence.
  const unmeasured = total.points === null;
  const scoring = total.points !== null && total.points > 0;

  const tip = unmeasured
    ? tx(w.channel_unmeasured, { name, weight })
    : scoring
      ? `${tx(w.channel_tip_scored, { name, weight, points: fmt(total.points), subjects: total.subjects ?? w.not_measured })} ${
          spec.code === 'deviation' || spec.code === 'citation_gone'
            ? tx(w.channel_tip_demand_tail, {
                n: model.unknownDemandBundles ?? w.not_measured,
                total: model.domains ?? w.not_measured,
              })
            : tx(w.channel_tip_all_bundles, { n: model.domains ?? w.not_measured })
        } ${tx(w.channel_sort_hint, { n: id })}`
      : `${name}, ${weight}. ${
          total.emptiness === 'unknown-remainder'
            ? tx(w.channel_zero_unknown, {
                known: model.demandKnownDomains?.length ?? w.not_measured,
                total: model.domains ?? w.not_measured,
                unknown: model.unknownDemandBundles ?? w.not_measured,
              })
            : total.emptiness === 'unmeasurable-remainder'
              ? tx(w.channel_zero_unmeasurable, { n: say(model.noClockApplications, w.not_measured) })
              : w.channel_zero_pure
        } ${tx(w.channel_sort_hint, { n: id })}`;

  const barWidth = Math.max(
    8,
    ((total.points ?? 0) / Math.max(1, model.planPoints ?? 0)) * 100 * 2.2,
  ).toFixed(1);

  return (
    <button
      type="button"
      className={`cb-chh${spec.group === 'mark' ? ' cb-narrow' : ''}`}
      data-role="cb-channel-head"
      data-cb-tip={tip}
      style={{ ['--cb-cc']: channelColour(id) } as React.CSSProperties}
      aria-pressed={solo === id}
      aria-label={name}
      onClick={() => {
        onSolo(id);
      }}
    >
      <span className="cb-gl">{spec.glyph}</span>
      <span className={`cb-n typo-data${scoring ? '' : ' cb-z'}`} data-role="cb-channel-count">
        {unmeasured ? <Unmeasured tip={tip} /> : scoring ? fmt(total.points) : 0}
      </span>
      <span className="cb-st">
        {unmeasured ? (
          <span className="cb-unk" />
        ) : scoring ? (
          <>
            <span className="cb-on" style={{ width: `${barWidth}%` }} />
            {(id === 1 || id === 7) && <span className="cb-unk" style={{ maxWidth: '34%' }} />}
          </>
        ) : (
          <>
            <span className="cb-flat" />
            {total.emptiness === 'unknown-remainder' && (
              <span className="cb-unk" style={{ maxWidth: '40%' }} />
            )}
            {total.emptiness === 'unmeasurable-remainder' && (
              <span className="cb-unm" style={{ maxWidth: '40%' }} />
            )}
          </>
        )}
      </span>
    </button>
  );
}

/**
 * The first group's head. With a plan it counts what the plan carries; without
 * one it becomes the bare label its three neighbours already are, with the
 * unknown mark where the two counts were - never "0 planned".
 */
function PlannedGroup({ model }: { model: BlueprintModel }) {
  const { w, tx } = useWords();
  if (model.rows === null) {
    return (
      <div className="cb-grp cb-g1 typo-eyebrow">
        <b data-role="cb-group-head">{w.group_planned_bare}</b>
        <span className="cb-dim">
          <Unmeasured /> {w.group_points_bare}
        </span>
        <span className="cb-ln" />
      </div>
    );
  }
  return (
    <div className="cb-grp cb-g1 typo-eyebrow">
      <b data-role="cb-group-head">{tx(w.group_planned, { n: model.rows.length })}</b>
      <span className="cb-dim">
        {tx(w.group_points, {
          n: say(model.planPoints, w.not_measured),
          total: say(model.subjects, w.not_measured),
        })}
      </span>
      <span className="cb-ln" />
    </div>
  );
}

export function LedgerHead(props: HeadProps) {
  const { model } = props;
  const { w } = useWords();
  return (
    <div className="cb-lhead cb-lrow" data-role="cb-ledger-row">
      <PlannedGroup model={model} />
      <div className="cb-grp cb-g2 typo-eyebrow" data-cb-tip={w.group_marks_gloss}>
        {w.group_marks}
        <span className="cb-ln" />
      </div>
      <div className="cb-grp cb-g3 typo-eyebrow" data-cb-tip={w.group_measures_gloss}>
        {w.group_measures}
        <span className="cb-ln" />
      </div>
      {/* No fourth group label. "points" sat directly above "total" and the
          two named the same column twice. */}
      <div className="cb-grp cb-g4" />

      <div className="cb-hid cb-idb typo-eyebrow cb-rankhead">{w.head_rank}</div>
      <div className="cb-hid cb-idb" />
      <div className="cb-hid cb-idb typo-eyebrow cb-subjecthead">{w.head_subject}</div>
      <div className="cb-hid cb-idb typo-eyebrow cb-bundlehead">{w.head_bundle}</div>
      {CHANNEL_ORDER.map((id) => (
        <Fragment key={id}>
          <ChannelHead {...props} id={id} />
          {id === 6 && <div className="cb-hid cb-hrule" />}
        </Fragment>
      ))}
      <div className="cb-hid cb-tot typo-eyebrow" data-role="cb-ledger-total">
        {w.head_total}
      </div>
    </div>
  );
}
