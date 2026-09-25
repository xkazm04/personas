/**
 * The drawing inside one channel's strip: the reason, drawn as itself.
 *
 * A spread gets a track with its floor and its ceiling; a technique count gets
 * filled pips against hollow ones for the design floor it is under; a single
 * stack gets the stack's own name. Nothing here is a generic bar, because a
 * generic bar would make nine different findings look like one.
 */
import { CHANNELS } from '../model/channels';
import type { BlueprintModel, BlueprintRow, ChannelMark } from '../model/types';
import { times, widthPct } from '../format';
import { useWords } from '../words';

function BigPips({ n }: { n: number }) {
  return (
    <span className="cb-pips" style={{ gap: '3px' }}>
      {times(n).map((i) => (
        <i key={i} style={{ width: '10px', height: '18px' }} />
      ))}
    </span>
  );
}

export function StripDrawing({ mark, row, model }: { mark: ChannelMark; row: BlueprintRow; model: BlueprintModel }) {
  const { w, tx } = useWords();
  const spec = CHANNELS.find((c) => c.id === mark.channel)!;
  const floor = mark.floor ?? mark.count ?? 0;
  const ceil = mark.ceil ?? floor;

  if (mark.channel === 1 || mark.channel === 7) {
    return (
      <>
        <span className="cb-track" style={{ flex: '0 0 190px', height: '16px' }}>
          <span className="cb-cl" style={{ width: widthPct(ceil, model.maxCeiling) }} />
          <span className="cb-fl" style={{ width: widthPct(floor, model.maxCeiling) }} />
        </span>
        <span className="typo-caption">
          {tx(w.strip_deviation_math, { floor, weight: spec.weight, points: mark.points })}
          {ceil !== floor ? ` ${tx(w.strip_deviation_ceiling, { ceil })}` : ''}
        </span>
        {row.demand && (
          <span className="typo-code cb-dim">
            {tx(w.strip_consults, {
              consults: row.demand.consults,
              contributors: row.demand.contributors,
            })}
          </span>
        )}
      </>
    );
  }
  if (mark.channel === 4) {
    return (
      <>
        <span className="cb-pips" style={{ gap: '3px' }}>
          {times(mark.count ?? 0).map((i) => (
            <i key={`f${String(i)}`} style={{ width: '10px', height: '18px' }} />
          ))}
          {times(Math.max(0, (mark.designFloor ?? 0) - (mark.count ?? 0))).map((i) => (
            <i key={`h${String(i)}`} className="cb-o" style={{ width: '10px', height: '18px' }} />
          ))}
        </span>
        <span className="typo-caption">
          {tx(w.strip_thin, { n: mark.count ?? 0, floor: mark.designFloor ?? 0 })}
        </span>
      </>
    );
  }
  if (mark.channel === 8) {
    return (
      <>
        <span className="cb-chips">
          {row.stacks.map((s) => (
            <span key={s} className="cb-chip typo-label">
              {s}
            </span>
          ))}
        </span>
        <span className="typo-caption">{w.strip_single_stack}</span>
      </>
    );
  }
  if (mark.channel === 5) {
    return (
      <>
        <BigPips n={3} />
        <span className="typo-caption">{tx(w.strip_never_swept, { n: spec.weight })}</span>
      </>
    );
  }
  if (mark.channel === 2) {
    return (
      <>
        <BigPips n={6} />
        <span className="typo-caption">{tx(w.strip_no_application, { n: row.techniques })}</span>
      </>
    );
  }
  if (mark.channel === 9) {
    return (
      <>
        <BigPips n={mark.count ?? 1} />
        <span className="typo-caption">{tx(w.strip_at_risk, { n: mark.count ?? 1 })}</span>
      </>
    );
  }
  return <BigPips n={Math.min(mark.points, 10)} />;
}
