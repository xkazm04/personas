/**
 * Voice as spokes: one per tone channel, its length the channel's stored
 * samples on the declared 0..5 domain (the prompt compiler renders five), the
 * channel's style star at the tip. A channel with no tone row at all draws a
 * dashed spoke. L2 (`detail`) puts a rules spoke (0..8) beside each samples
 * spoke and moves the stars onto one outer ring so they line up.
 */
import type { BlueprintChannel } from '../../../blueprintContract';
import { Chevrons } from './primitives';
import { StyleStar } from './StyleStar';
import { type Band, arcLength, bandPath, polar, sectorPath, spokePath } from '../radialGeometry';
import { EXEMPLARS_FULL_AT, RULES_FULL_AT, share } from '../radialModel';

interface VoiceSpokesProps {
  band: Band;
  channels: readonly BlueprintChannel[];
  detail?: boolean;
  hot?: string | null;
  lit?: string | null;
  onHot?: (channel: string | null) => void;
  onPick?: (channel: string) => void;
}

/** The angle of each channel's spoke, evenly across the band. */
export function spokeAngles(band: Band, n: number): number[] {
  const step = (band.a1 - band.a0) / Math.max(1, n);
  return Array.from({ length: n }, (_, i) => band.a0 + (i + 0.5) * step);
}

/** The star radius a band of `n` spokes leaves room for. */
export function starRadius(band: Band, n: number, detail: boolean): number {
  const step = (band.a1 - band.a0) / Math.max(1, n);
  const room = arcLength((band.r0 + band.r1) / 2, step);
  return Math.max(3, Math.min((band.r1 - band.r0) * (detail ? 0.14 : 0.16), room * (detail ? 0.3 : 0.36), detail ? 30 : 18));
}

export function VoiceSpokes({ band, channels, detail = false, hot, lit, onHot, onPick }: VoiceSpokesProps) {
  const { cx, cy, r0, r1 } = band;
  const n = channels.length;
  if (n === 0) return <path className="rd-dash" d={bandPath(band)} data-empty="true" />;
  const angles = spokeAngles(band, n);
  const step = (band.a1 - band.a0) / n;
  const starR = starRadius(band, n, detail);
  const base = r0 + 2;
  const maxTip = r1 - 2 * starR - (detail ? 8 : 2);
  const off = detail ? step * 0.17 : 0;

  return (
    <g data-testid="radial-spokes" data-count={n}>
      {detail && <circle className="rd-full-line" cx={cx} cy={cy} r={maxTip} />}
      {channels.map((c, i) => {
        const a = angles[i] ?? 0;
        const tipS = base + share(c.exemplars, EXEMPLARS_FULL_AT) * (maxTip - base);
        const tipR = base + share(c.rules, RULES_FULL_AT) * (maxTip - base);
        const star = polar(cx, cy, detail ? r1 - starR : tipS + starR + 1, a);
        const unvoiced = c.origin === null;
        return (
          <g
            key={c.channel}
            className="rd-channel"
            data-channel={c.channel}
            data-hot={hot === c.channel || lit === c.channel ? 'true' : undefined}
            data-voiced={unvoiced ? 'false' : 'true'}
            onPointerEnter={onHot ? () => onHot(c.channel) : undefined}
            onPointerLeave={onHot ? () => onHot(null) : undefined}
            onClick={onPick ? () => onPick(c.channel) : undefined}
          >
            {onPick && <path className="rd-hit" d={sectorPath(cx, cy, r0, r1, a - step / 2, a + step / 2)} />}
            <path className="rd-spoke-track" d={spokePath(cx, cy, base, maxTip, a - off)} />
            <path className={unvoiced ? 'rd-spoke is-unvoiced' : 'rd-spoke'} d={spokePath(cx, cy, base, tipS, a - off)} />
            {c.exemplars > EXEMPLARS_FULL_AT && (
              <Chevrons cx={cx} cy={cy} r={detail ? maxTip + 4 : tipS + 2 * starR + 6} deg={a - off} size={6} dir="out" />
            )}
            {detail && (
              <>
                <path className="rd-spoke-track" d={spokePath(cx, cy, base, maxTip, a + off)} />
                <path className="rd-rule" d={spokePath(cx, cy, base, tipR, a + off)} />
                {c.rules > RULES_FULL_AT && <Chevrons cx={cx} cy={cy} r={maxTip + 4} deg={a + off} size={6} dir="out" />}
              </>
            )}
            <StyleStar x={star.x} y={star.y} r={starR} dims={c.dims} />
          </g>
        );
      })}
    </g>
  );
}
