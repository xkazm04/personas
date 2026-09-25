/**
 * THE CELL - every reason drawn as itself, and the three empty states kept
 * visibly apart: a count, a measured nothing, and an unknown.
 *
 * This is the file the honesty rule lives in. A cell is never handed a number;
 * it is handed a `CellMark`, and each arm of that union has its own ink. There
 * is no branch here that can turn an unknown into a zero, because there is no
 * number to turn.
 */
import { channelColour, channelSpec, type ChannelId } from '../model/channels';
import type { BlueprintRow, CellMark, ChannelMark } from '../model/types';
import { times, widthPct } from '../format';
import { useWords } from '../words';

interface CellProps {
  channel: ChannelId;
  cell: CellMark;
  row: BlueprintRow;
  maxPoints: number;
  maxCeiling: number;
  /** The port's hook for the style contract, on every cell like the winner's. */
  role?: string;
  /** The origin band rings the column the hovered strip grew from. */
  ring?: boolean;
}

function Pips({ filled, hollow }: { filled: number; hollow?: number }) {
  return (
    <span className="cb-pips">
      {times(filled).map((i) => (
        <i key={`f${String(i)}`} />
      ))}
      {times(hollow ?? 0).map((i) => (
        <i key={`h${String(i)}`} className="cb-o" />
      ))}
    </span>
  );
}

/** Channels 1 and 7 carry a spread: a dashed ceiling and a solid floor. */
function Spread({ mark, maxCeiling }: { mark: ChannelMark; maxCeiling: number }) {
  const floor = mark.floor ?? mark.count ?? 0;
  const ceil = mark.ceil ?? floor;
  return (
    <>
      <span className="cb-track">
        <span className="cb-cl" style={{ width: widthPct(ceil, maxCeiling) }} />
        <span className="cb-fl" style={{ width: widthPct(floor, maxCeiling) }} />
      </span>
      <span className="cb-num typo-data">
        {floor}
        {ceil !== floor && <span className="cb-ce">{`–${String(ceil)}`}</span>}
      </span>
    </>
  );
}

function ScoredInk({ mark, maxCeiling }: { mark: ChannelMark; maxCeiling: number }) {
  switch (mark.channel) {
    case 1:
    case 7:
      return <Spread mark={mark} maxCeiling={maxCeiling} />;
    case 2:
      return <Pips filled={6} />;
    case 3:
      return <Pips filled={Math.min(mark.points, 8)} />;
    case 4:
      return (
        <Pips
          filled={mark.count ?? 0}
          hollow={Math.max(0, (mark.designFloor ?? 0) - (mark.count ?? 0))}
        />
      );
    case 5:
      return <Pips filled={3} />;
    case 6:
      return <Pips filled={Math.min(mark.count ?? 1, 8)} />;
    case 8:
      return <span className="cb-chip typo-label">{mark.stack}</span>;
    default:
      return <Pips filled={mark.count ?? 1} />;
  }
}

export function LedgerCell({ channel, cell, row, maxPoints, maxCeiling, role, ring }: CellProps) {
  const { w, tx } = useWords();
  const spec = channelSpec(channel);
  const name = w.channel[`c${String(channel)}` as keyof typeof w.channel];
  const style: React.CSSProperties & Record<string, string> = { ['--cb-cc']: channelColour(channel) };
  const wide = `${spec.group === 'measure' ? ' cb-wide' : ''}${ring ? ' cb-ring' : ''}`;

  if (cell.kind === 'scored') {
    // Alpha climbs with the clause's share of the heaviest subject, capped so
    // the wash never competes with the mark drawn on top of it.
    style['--cb-a'] = Math.min(0.3, 0.05 + (cell.mark.points / maxPoints) * 0.3).toFixed(3);
    return (
      <div
        className={`cb-cell${wide}`}
        data-role={role}
        data-cb-tip={tx(w.cell_scored, { detail: cell.mark.detail, points: cell.mark.points })}
        style={style}
      >
        <ScoredInk mark={cell.mark} maxCeiling={maxCeiling} />
      </div>
    );
  }

  if (cell.kind === 'unknown') {
    return (
      <div
        className={`cb-cell${wide}`}
        data-role={role}
        data-cb-tip={tx(w.cell_unknown, { name, domain: row.domain })}
        style={style}
      >
        <span className="cb-unkbox" />
      </div>
    );
  }

  if (cell.kind === 'unmeasurable') {
    return (
      <div
        className={`cb-cell${wide}`}
        data-role={role}
        data-cb-tip={tx(w.cell_unmeasurable, { name })}
        style={style}
      >
        <span className="cb-swatch cb-ink-unmeasurable" />
      </div>
    );
  }

  return (
    <div
      className={`cb-cell${wide}`}
      data-role={role}
      data-cb-tip={tx(w.cell_measured_zero, { name })}
      style={style}
    >
      <span className="cb-flat" />
    </div>
  );
}
