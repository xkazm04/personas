import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { channelLabel } from './channelLabel';
import type { BlueprintChannel, TwinBlueprintModel } from '../../blueprintContract';
import { Unmeasured } from './Lettering';
import { OriginLegend, OriginMark } from './OriginMark';
import { DIM_KEYS, DIM_MAX, channelState } from './draftingTwinModel';
import DrawFrame from './draw/DrawFrame';
import Write, { WriteNumber } from './draw/Write';

const LEVEL_KEYS = ['l1', 'l2', 'l3', 'l4', 'l5'] as const;
const COLUMNS = 'minmax(7rem, 10rem) repeat(8, minmax(2.25rem, 3rem)) repeat(4, minmax(3.5rem, 4.5rem))';

/** A ruled line under a row or a cell: a frame, traced along its length. */
function Rule({ dashed = false, strong = false }: { dashed?: boolean; strong?: boolean }) {
  return (
    <i
      aria-hidden
      data-draw="frame"
      data-draw-wipe="x"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0"
      style={{ borderTop: `1px ${dashed ? 'dashed' : 'solid'} ${strong ? 'var(--ink-dim)' : 'var(--ink-faint)'}` }}
    />
  );
}

/**
 * Voice zoomed (L2): a drawing schedule, one row per channel and one column
 * per style dimension, each cell a column as tall as its 1..5 value, then the
 * channel's samples, rules, directives and where its style came from. The
 * column heads are lettered at an angle, as a schedule on a drawing is, so
 * every name keeps its full size. A channel's name opens its full detail. In
 * the draw-in the rules are frames; the heads letter one after another, and
 * every row draws its own cells left to right.
 */
export default function VoiceSchedule({
  voice,
  onOpen,
}: {
  voice: TwinBlueprintModel['voice'];
  onOpen: (channel: string) => void;
}) {
  const { t } = useTranslation();
  const m = t.twin.blueprint.metrics;
  const dims = t.twin.style.dims;
  const heads = [...DIM_KEYS.map((k) => dims[k].label), m.samples, m.rules, m.directives, t.twin.blueprint.variantCopy.drafting.origin];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pr-20">
      <div className="relative grid items-end" style={{ gridTemplateColumns: COLUMNS }} aria-hidden data-draw-scope="">
        <span />
        {heads.map((h) => (
          <span key={h} className="relative h-24">
            <span
              className="typo-label absolute bottom-1 left-1/2 origin-bottom-left -rotate-45 whitespace-nowrap"
              style={{ color: 'var(--ink-strong)' }}
            >
              <Write text={h} />
            </span>
          </span>
        ))}
        <Rule strong />
      </div>
      <ul className="flex min-h-0 flex-col">
        {voice.channels.map((c) => (
          <ScheduleRow key={c.channel} channel={c} name={channelLabel(c.channel, t.twin.experience.sheet.everywhere)} onOpen={onOpen} />
        ))}
      </ul>
      <OriginLegend />
    </div>
  );
}

function ScheduleRow({ channel, name, onOpen }: { channel: BlueprintChannel; name: string; onOpen: (channel: string) => void }) {
  const { t } = useTranslation();
  const dims = t.twin.style.dims;
  const values = channel.dims;
  const state = channelState(channel);
  return (
    <li data-channel={channel.channel} data-state={state} data-draw-scope="" className="relative grid items-center py-1" style={{ gridTemplateColumns: COLUMNS }}>
      <Button variant="ghost" size="sm" className="min-w-0 justify-start" onClick={() => onOpen(channel.channel)}>
        <span className="truncate typo-body text-foreground">
          <Write text={name} />
        </span>
      </Button>
      {values ? (
        DIM_KEYS.map((key) => {
          const v = values[key];
          const lk = LEVEL_KEYS[v - 1];
          const level = lk ? dims[key][lk] : String(v);
          return (
            <Tooltip key={key} content={`${dims[key].label}: ${level}`}>
              <span className="relative flex h-8 items-end justify-center">
                <span
                  data-draw="rise"
                  className="w-3"
                  style={{ height: `${(v / DIM_MAX) * 100}%`, background: 'color-mix(in srgb, var(--ink) 50%, transparent)', borderTop: '2px solid var(--ink-strong)' }}
                />
                <Rule strong />
              </span>
            </Tooltip>
          );
        })
      ) : (
        <span className="relative flex h-8 items-center px-1" style={{ gridColumn: 'span 8' }} data-measured="false">
          {state === 'unvoiced' ? (
            <span className="relative h-full w-full" style={{ border: '1px solid transparent' }}>
              <DrawFrame stroke="var(--ink-faint)" dash="4 3" />
            </span>
          ) : (
            <Unmeasured className="h-full w-full" />
          )}
        </span>
      )}
      <span className="flex justify-center">
        <WriteNumber value={channel.exemplars} className="typo-data text-foreground" />
      </span>
      <span className="flex justify-center">
        <WriteNumber value={channel.rules} className="typo-data text-foreground" />
      </span>
      <span className="flex justify-center">
        <Directives on={channel.hasDirectives} />
      </span>
      <span className="flex justify-center">
        <OriginMark origin={channel.origin} />
      </span>
      <Rule dashed={state !== 'voiced'} />
    </li>
  );
}

function Directives({ on }: { on: boolean }) {
  return (
    <svg aria-hidden width={18} height={18} className="overflow-visible">
      {on ? (
        <>
          <circle cx={9} cy={9} r={8} fill="none" stroke="var(--ink)" pathLength={100} data-draw="stroke" />
          <path d="M5 9.5 L8 12.5 L13.5 6" fill="none" stroke="var(--ink-strong)" strokeWidth={1.75} pathLength={100} data-draw="tick" />
        </>
      ) : (
        <circle cx={9} cy={9} r={8} fill="none" stroke="var(--ink-dim)" strokeDasharray="3 2" data-draw="mark" />
      )}
    </svg>
  );
}
