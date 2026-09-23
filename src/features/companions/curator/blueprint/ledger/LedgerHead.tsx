/**
 * The sticky head: the group labels, then the nine icon column heads.
 *
 * The head is a `.cb-lrow` like every other row and carries the same
 * `cb-ledger-row` / `cb-ledger-total` hooks the data rows do - which is what
 * the winner's own selectors did (`#lscroll .lrow:not(.band)` matched the head
 * first), so the contract compares the same element on both sides.
 */
import { Fragment } from 'react';

import { channelColour, CHANNEL_ORDER, CHANNELS, type ChannelId } from '../model/channels';
import type { BlueprintModel, ChannelTotal } from '../model/types';
import { fmt } from '../format';
import { useWords } from '../words';

interface HeadProps {
  model: BlueprintModel;
  solo: ChannelId | 0;
  onSolo: (channel: ChannelId) => void;
}

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
  const scoring = total.points > 0;

  const tip = scoring
    ? `${tx(w.channel_tip_scored, { name, weight, points: fmt(total.points), subjects: total.subjects })} ${
        spec.code === 'deviation' || spec.code === 'citation_gone'
          ? tx(w.channel_tip_demand_tail, { n: model.unknownDemandBundles, total: model.domains })
          : tx(w.channel_tip_all_bundles, { n: model.domains })
      } ${tx(w.channel_sort_hint, { n: id })}`
    : `${name}, ${weight}. ${
        total.emptiness === 'unknown-remainder'
          ? tx(w.channel_zero_unknown, {
              known: model.demandKnownDomains.length,
              total: model.domains,
              unknown: model.unknownDemandBundles,
            })
          : total.emptiness === 'unmeasurable-remainder'
            ? tx(w.channel_zero_unmeasurable, { n: fmt(model.noClockApplications) })
            : w.channel_zero_pure
      } ${tx(w.channel_sort_hint, { n: id })}`;

  const barWidth = Math.max(8, (total.points / Math.max(1, model.planPoints)) * 100 * 2.2).toFixed(1);

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
        {scoring ? fmt(total.points) : 0}
      </span>
      <span className="cb-st">
        {scoring ? (
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
      <span className="cb-w typo-code">{weight}</span>
    </button>
  );
}

export function LedgerHead(props: HeadProps) {
  const { model } = props;
  const { w, tx } = useWords();
  return (
    <div className="cb-lhead cb-lrow" data-role="cb-ledger-row">
      <div className="cb-grp cb-g1 typo-label cb-up">
        <b data-role="cb-group-head">{tx(w.group_planned, { n: model.rows.length })}</b>
        <span className="cb-dim">
          {tx(w.group_points, { n: fmt(model.planPoints), total: fmt(model.subjects) })}
        </span>
        <span className="cb-ln" />
      </div>
      <div className="cb-grp cb-g2 typo-label cb-up">
        {w.group_marks}
        <span className="cb-gloss">{w.group_marks_gloss}</span>
        <span className="cb-ln" />
      </div>
      <div className="cb-grp cb-g3 typo-label cb-up">
        {w.group_measures}
        <span className="cb-gloss">{w.group_measures_gloss}</span>
        <span className="cb-ln" />
      </div>
      <div className="cb-grp cb-g4 typo-label cb-up cb-dim">{w.group_total}</div>

      <div className="cb-hid cb-idb typo-label cb-up cb-rankhead">{w.head_rank}</div>
      <div className="cb-hid cb-idb" />
      <div className="cb-hid cb-idb typo-label cb-up cb-subjecthead">{w.head_subject}</div>
      <div className="cb-hid cb-idb typo-label cb-up cb-bundlehead">{w.head_bundle}</div>
      {CHANNEL_ORDER.map((id) => (
        <Fragment key={id}>
          <ChannelHead {...props} id={id} />
          {id === 6 && <div className="cb-hid cb-hrule" />}
        </Fragment>
      ))}
      <div className="cb-hid cb-tot typo-label cb-up" data-role="cb-ledger-total">
        {w.head_total}
      </div>
    </div>
  );
}
