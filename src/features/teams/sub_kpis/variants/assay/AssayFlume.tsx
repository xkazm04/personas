// THE FLUME - one mechanism's population drawn as a channel that narrows at
// every gate, with the loss left in the frame.
//
// A figure (doctrine 6c): replace it with a labelled list of the same four
// numbers and the comparison between lanes is gone, which is the whole point.
// Its geometry carries three rules, all of them borrowed from the riverbed:
//
//  * The CHANNEL is a constant height, so a lane's shape is its YIELD and not
//    its size. 829 declared and 184 declared are drawn the same height on
//    purpose; the size is printed beside the lane, where it can be read off.
//  * The LOSS STAYS IN THE FRAME. A narrowed channel does not re-centre and
//    the space above it is not empty - it is hatched, because that is the
//    estate's own claim with nothing behind it. A funnel that redrew itself
//    to fill the box would make 0.6 % yield look like 100 %.
//  * The HAIRLINE ON A LOSS SAYS WHICH GATE DROPPED IT, in the module's own
//    ramp: muted for want of a reading (`unmeasured`), warning for a reading
//    nothing can judge (`unpaced`). Same two tones `EstateHeadline` uses for
//    the same two facts.
import { HATCH_BG } from '../../kpiChartTheme';
import type { AssayLane } from './Assay.model';

/** Tall enough that a 0.6 % channel is still a visible line (1px at 76), and
 *  short enough that four lanes and their rails fit one screen unscrolled. */
export const FLUME_HEIGHT = 76;

/** A loss band shorter than this cannot hold its own figure legibly, so the
 *  number moves to the lane's caption instead of being clipped. */
const LABEL_FLOOR = 20;

const MUTED = 'var(--muted-foreground)';
const WARNING = 'var(--status-warning)';

interface Band {
  key: string;
  /** Share of the lane's declared population, 0..1. */
  share: number;
  kind: 'live' | 'lost' | 'carried';
  color?: string;
  /** The gate's own tone, drawn as a hairline on top of a fresh loss. */
  edge?: string;
  figure?: string;
}

/** Top-down bands for one stage column. A stage shows what survived INTO it,
 *  what it has just dropped, and what earlier gates already dropped. */
function bandsFor(lane: AssayLane, stage: 0 | 1 | 2): Band[] {
  const d = Math.max(1, lane.declared);
  const live = (n: number, color?: string) => ({ key: `live-${color ?? ''}`, share: n / d, kind: 'live' as const, color });
  if (stage === 0) return [live(lane.declared)];
  if (stage === 1) {
    return [
      { key: 'drop', share: lane.dark / d, kind: 'lost', edge: MUTED, figure: `-${lane.dark}` },
      live(lane.observed),
    ];
  }
  return [
    { key: 'carried', share: lane.dark / d, kind: 'carried' },
    { key: 'drop', share: lane.unjudged / d, kind: 'lost', edge: WARNING, figure: `-${lane.unjudged}` },
    { key: 'met', share: lane.met / d, kind: 'live', color: 'var(--status-success)' },
    { key: 'on', share: lane.onTrack / d, kind: 'live', color: 'var(--primary)' },
    { key: 'off', share: lane.offTrack / d, kind: 'live', color: 'var(--status-error)' },
  ];
}

export function AssayFlume({ lane, label }: { lane: AssayLane; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex items-stretch overflow-hidden rounded-interactive border border-primary/15"
      style={{ height: FLUME_HEIGHT }}
    >
      {([0, 1, 2] as const).map((stage) => (
        <div
          key={stage}
          className={`relative flex min-w-0 flex-1 flex-col justify-end ${stage < 2 ? 'border-r border-primary/20' : ''}`}
        >
          {bandsFor(lane, stage).map((band) => (
            <BandFill key={band.key} band={band} />
          ))}
        </div>
      ))}
    </div>
  );
}

function BandFill({ band }: { band: Band }) {
  if (band.share <= 0) return null;
  const height = `${band.share * 100}%`;
  const px = band.share * FLUME_HEIGHT;
  const lost = band.kind !== 'live';
  return (
    <span
      className="relative block w-full shrink-0"
      style={{
        height,
        backgroundImage: lost ? HATCH_BG : undefined,
        // A carried loss is the same hatch at half strength: it is already
        // accounted for one column to the left, so it must not read as news.
        opacity: band.kind === 'carried' ? 0.45 : 1,
        background: band.kind === 'live' ? fill(band.color) : undefined,
        borderTop: band.edge ? `1px solid ${band.edge}` : undefined,
      }}
    >
      {band.figure && px >= LABEL_FLOOR && (
        <span className="absolute right-1 top-0.5 typo-caption tabular-nums" style={{ color: band.edge }}>
          {band.figure}
        </span>
      )}
    </span>
  );
}

/** A live band with no verdict colour is the population still in the channel,
 *  not a state - so it takes the theme's own hue at a low alpha and never one
 *  of the status hues. */
function fill(color: string | undefined): string {
  return color ? `color-mix(in srgb, ${color} 55%, transparent)` : 'color-mix(in srgb, var(--primary) 20%, transparent)';
}
