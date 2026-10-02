import type { Ref } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { BlueprintChannel } from '../../blueprintContract';
import { BreakMark, Unmeasured } from './Lettering';
import { DIM_KEYS, DIM_MAX, TICK_CAP, channelState, type ChannelState } from './draftingTwinModel';
import DrawFrame from './draw/DrawFrame';
import Write from './draw/Write';

/**
 * One channel's voice as a small elevation: eight stations, one per style
 * dimension, each column as tall as its 1..5 value, inside a frame that is
 * solid when the channel has written directives and dashed when it does not.
 * Under it a tick row: writing samples tick up from the baseline, rules tick
 * down. No stored style is hatched (not measured); no tone row is an empty
 * dashed frame. In the draw-in the glyph is a container: its name is lettered,
 * then the stations rise one by one, then the ticks are struck.
 */
export default function ChannelGlyph({
  channel,
  name,
  compact = false,
  targeted = false,
  tall = false,
  markRef,
}: {
  channel: BlueprintChannel;
  name: string;
  /** Stage mode: one line, name beside a short elevation, no ticks. */
  compact?: boolean;
  targeted?: boolean;
  /** A lone channel draws a taller elevation, filling its region. */
  tall?: boolean;
  markRef?: Ref<HTMLDivElement>;
}) {
  const state = channelState(channel);
  return (
    <div
      ref={markRef}
      data-channel={channel.channel}
      data-state={state}
      data-delta-target={targeted || undefined}
      data-draw-scope=""
      className={`flex min-h-0 min-w-0 rounded-interactive ${compact ? 'items-center gap-3 px-1.5' : 'flex-col gap-1.5 p-1'} ${targeted ? 'twd-target' : ''}`}
    >
      <span className={`min-w-0 truncate typo-body text-foreground ${compact ? 'flex-1' : ''}`}>
        <Write text={name} />
      </span>
      <Elevation channel={channel} state={state} className={compact ? 'h-5 w-12 shrink-0' : `min-h-10 w-full flex-1 ${tall ? 'max-h-40' : 'max-h-32'}`} />
      {!compact && <TickRow exemplars={channel.exemplars} rules={channel.rules} />}
    </div>
  );
}

export function Elevation({ channel, state, className }: { channel: BlueprintChannel; state: ChannelState; className: string }) {
  const dims = channel.dims;
  const stroke = state === 'voiced' ? 'var(--ink)' : state === 'unvoiced' ? 'var(--ink-faint)' : 'var(--ink-dim)';
  return (
    <div className={`twd-elev relative flex items-end gap-0.5 p-0.5 ${className}`} style={{ border: '1px solid transparent' }} data-measured={dims ? 'true' : 'false'}>
      <DrawFrame stroke={stroke} dash={state === 'voiced' ? undefined : '4 3'} />
      {dims ? (
        DIM_KEYS.map((key) => (
          <span
            key={key}
            data-draw="rise"
            className="min-w-0 flex-1"
            style={{
              height: `${(dims[key] / DIM_MAX) * 100}%`,
              background: 'color-mix(in srgb, var(--ink) 45%, transparent)',
              borderTop: '2px solid var(--ink-strong)',
            }}
          />
        ))
      ) : state === 'manual' ? (
        <Unmeasured className="h-full w-full" />
      ) : null}
    </div>
  );
}

const TICK_STEP = 7;

function TickRow({ exemplars, rules }: { exemplars: number; rules: number }) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const up = Math.min(exemplars, TICK_CAP);
  const down = Math.min(rules, TICK_CAP);
  const width = TICK_CAP * TICK_STEP + 2;
  return (
    <Tooltip
      content={
        <span>
          {m.samples} <Numeric value={exemplars} /> · {m.rules} <Numeric value={rules} />
        </span>
      }
    >
      <span className="flex items-center gap-1" data-exemplars={exemplars} data-rules={rules}>
        <svg aria-hidden width={width} height={18} className="shrink-0 overflow-visible">
          <line x1={0} y1={9} x2={width} y2={9} stroke="var(--ink-dim)" strokeWidth={1} pathLength={100} data-draw="frame" />
          {Array.from({ length: up }, (_, i) => (
            <line key={`e${i}`} x1={2 + i * TICK_STEP} y1={9} x2={2 + i * TICK_STEP} y2={1} stroke="var(--ink-strong)" strokeWidth={1.5} pathLength={100} data-draw="tick" />
          ))}
          {Array.from({ length: down }, (_, i) => (
            <line key={`r${i}`} x1={2 + i * TICK_STEP} y1={9} x2={2 + i * TICK_STEP} y2={15} stroke="var(--ink)" strokeWidth={1.5} pathLength={100} data-draw="tick" />
          ))}
        </svg>
        {(exemplars > TICK_CAP || rules > TICK_CAP) && <BreakMark height={18} />}
      </span>
    </Tooltip>
  );
}
