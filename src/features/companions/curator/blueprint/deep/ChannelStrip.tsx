/**
 * One channel, grown out of its own cell.
 *
 * The nine strips read as a skyline: height is how much this subject's defect
 * has to say. A channel with nothing in it gets ONE line - and even at one
 * line the three empty states stay apart, because a flat tick, a see-through
 * box and the sentence beside them are three different claims.
 */
import { channelColour, CHANNELS, type ChannelId } from '../model/channels';
import type { BlueprintModel, BlueprintRow } from '../model/types';
import { fmt } from '../format';
import { useWords } from '../words';

import { StripDrawing } from './StripDrawing';

interface StripProps {
  channel: ChannelId;
  row: BlueprintRow;
  model: BlueprintModel;
}

function Ruler({ channel }: { channel: ChannelId }) {
  return (
    <span className="cb-ruler" aria-hidden="true">
      {CHANNELS.map((spec) => (
        <i
          key={spec.id}
          className={spec.id === channel ? 'cb-me' : undefined}
          style={{ background: spec.id === channel ? channelColour(spec.id) : 'var(--cb-rule-2)' }}
        />
      ))}
    </span>
  );
}

export function ChannelStrip({ channel, row, model }: StripProps) {
  const { w, tx } = useWords();
  const spec = CHANNELS.find((c) => c.id === channel)!;
  const name = w.channel[`c${String(channel)}` as keyof typeof w.channel];
  const weight = spec.multiplied ? tx(w.weight_each, { n: spec.weight }) : String(spec.weight);
  const cell = row.cells[channel];
  const style = { ['--cb-cc']: channelColour(channel) } as React.CSSProperties;

  if (cell.kind !== 'scored') {
    const unknown = cell.kind === 'unknown';
    // A measured nothing says WHY it is a nothing. Where the whole column
    // reads zero the reason is the corpus's, and the three corpus reasons are
    // three different sentences; where the column scores elsewhere, this
    // subject simply does not carry this defect.
    const columnEmpty = model.totals[channel].emptiness;
    const say =
      columnEmpty === 'unknown-remainder'
        ? tx(w.channel_zero_unknown, {
            known: model.demandKnownDomains.length,
            total: model.domains,
            unknown: model.unknownDemandBundles,
          })
        : columnEmpty === 'unmeasurable-remainder'
          ? tx(w.channel_zero_unmeasurable, { n: fmt(model.noClockApplications) })
          : columnEmpty === 'pure'
            ? w.channel_zero_pure
            : w.strip_subject_clean;
    return (
      <div
        className="cb-strip cb-empty"
        data-cb-ch={channel}
        data-role="cb-strip"
        tabIndex={0}
        style={style}
        data-cb-tip={
          unknown ? tx(w.strip_unknown_tip, { domain: row.domain }) : tx(w.strip_measured_tip, { say })
        }
      >
        <div className="cb-strip-in">
          <span className="cb-gl-lg">{spec.glyph}</span>
          <Ruler channel={channel} />
          <span className="typo-title">{name}</span>
          <span className="cb-w typo-code">{weight}</span>
          <span className="cb-say typo-caption">
            {unknown ? <span className="cb-unkbox" /> : <span className="cb-flat" style={{ width: '22px' }} />}{' '}
            {unknown ? (
              <>
                <b style={{ color: 'var(--foreground)' }}>{w.strip_unknown}</b> {w.strip_nobody_looked}
              </>
            ) : (
              w.strip_measured_nothing
            )}
          </span>
          <span className={`cb-pts typo-data cb-z`}>{unknown ? '?' : 0}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cb-strip" data-cb-ch={channel} data-role="cb-strip" tabIndex={0} style={style}>
      <div className="cb-strip-in">
        <span className="cb-gl-lg">{spec.glyph}</span>
        <Ruler channel={channel} />
        <span className="cb-hd">
          <span className="typo-title">{name}</span>
          <span className="cb-w typo-code">{weight}</span>
        </span>
        <span className="cb-pts typo-data">{fmt(cell.mark.points)}</span>
        <span className="cb-say typo-caption">{cell.mark.detail}</span>
        <span className="cb-draw">
          <StripDrawing mark={cell.mark} row={row} model={model} />
        </span>
      </div>
    </div>
  );
}
