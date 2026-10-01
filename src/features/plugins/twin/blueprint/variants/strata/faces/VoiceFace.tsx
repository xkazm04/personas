/**
 * Voice plate: one slot per channel. Two columns rise from the base line: the
 * stored samples (full at the five the prompt compiler renders) and the rules
 * (full at eight). The strip under a slot is solid when the channel has written
 * directives, dashed when not; a channel with no stored style carries a hatched
 * cap, and a channel never voiced at all is drawn as a dashed outline.
 */
import type { TwinBlueprintModel } from '../../../blueprintContract';
import { EXEMPLARS_FULL_AT, RULES_FULL_AT, share } from '../strataModel';
import { FaceSvg } from './FaceSvg';

const LEFT = 6;
const SPAN = 88;
const BASE = 48;
const RISE = 38;

export function VoiceFace({ model, hatch, hot }: { model: TwinBlueprintModel; hatch: string; hot: string | null }) {
  const channels = model.voice.channels;
  const slot = SPAN / Math.max(1, channels.length);
  return (
    <FaceSvg hatch={hatch}>
      <line className="sf-axis" x1={LEFT} x2={LEFT + SPAN} y1={BASE} y2={BASE} />
      {channels.map((c, i) => {
        const x = LEFT + i * slot;
        const col = slot * 0.34;
        if (c.origin === null) {
          return (
            <rect
              key={c.channel}
              className="sf-dash"
              x={x + slot * 0.12}
              y={BASE - RISE}
              width={slot * 0.76}
              height={RISE}
              data-measured="false"
            />
          );
        }
        const ex = RISE * share(c.exemplars, EXEMPLARS_FULL_AT);
        const ru = RISE * share(c.rules, RULES_FULL_AT);
        return (
          <g key={c.channel} className={hot === c.channel ? 'sf-hot' : undefined} data-channel={c.channel}>
            <rect className="sf-ink" x={x + slot * 0.12} y={BASE - ex} width={col} height={ex} />
            <rect className="sf-soft" x={x + slot * 0.54} y={BASE - ru} width={col} height={ru} />
            {c.dims === null && (
              <rect
                x={x + slot * 0.12}
                y={BASE - RISE}
                width={slot * 0.76}
                height={5}
                fill={`url(#${hatch})`}
                data-measured="false"
              />
            )}
            <rect
              className={c.hasDirectives ? 'sf-ink' : 'sf-dash'}
              x={x + slot * 0.12}
              y={BASE + 3}
              width={slot * 0.76}
              height={5}
            />
          </g>
        );
      })}
    </FaceSvg>
  );
}
