import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import ChannelGlyph from './ChannelGlyph';
import { channelLabel } from './channelLabel';
import { VOICE_L1_CELLS, voiceColumns } from './draftingTwinModel';
import DrawFrame from './draw/DrawFrame';
import Write from './draw/Write';

/**
 * Voice on layer one: one elevation glyph per channel in a grid of up to
 * nine; a tenth channel and beyond are counted in the last cell and drawn in
 * the zoom. Stage mode lists the channels one per line beside a short
 * elevation, so the column stays narrow beside the card. Each glyph draws
 * itself as its own container; the overflow cell is a frame with its count.
 */
export default function VoiceDrawing({
  voice,
  compact = false,
  targetKey,
  register,
}: {
  voice: TwinBlueprintModel['voice'];
  compact?: boolean;
  /** `channel:<id>` when the last answer was about a channel. */
  targetKey?: string | null;
  register?: (key: string) => (el: HTMLElement | null) => void;
}) {
  const { t, tx } = useTranslation();
  const everywhere = t.twin.experience.sheet.everywhere;
  const channels = voice.channels;
  const unvoiced = channels.every((c) => c.origin === null);

  if (channels.length === 0) {
    return (
      <p className="typo-caption">
        <Write text={t.twin.blueprint.states.emptyVoice} />
      </p>
    );
  }

  if (compact) {
    return (
      <ul className="grid min-h-0 gap-x-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))' }}>
        {channels.map((c) => (
          <li key={c.channel} className="min-w-0">
            <ChannelGlyph
              channel={c}
              name={channelLabel(c.channel, everywhere)}
              compact
              targeted={targetKey === `channel:${c.channel}`}
              markRef={register?.(`channel:${c.channel}`)}
            />
          </li>
        ))}
      </ul>
    );
  }

  const overflow = channels.length > VOICE_L1_CELLS;
  const shown = overflow ? channels.slice(0, VOICE_L1_CELLS - 1) : channels;
  const cols = voiceColumns(channels.length);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-x-4 gap-y-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: 'minmax(0, 1fr)' }}>
        {shown.map((c) => (
          <ChannelGlyph key={c.channel} channel={c} name={channelLabel(c.channel, everywhere)} tall={cols === 1} />
        ))}
        {overflow && (
          <div className="relative flex items-center justify-center p-1" style={{ border: '1px solid transparent' }} data-draw-scope="">
            <DrawFrame stroke="var(--ink-dim)" dash="4 3" />
            <Numeric className="typo-body text-foreground">
              <Write text={tx(t.twin.blueprint.variantCopy.drafting.moreChannels, { count: channels.length - shown.length })} />
            </Numeric>
          </div>
        )}
      </div>
      {unvoiced && (
        <p className="typo-caption">
          <Write text={t.twin.blueprint.states.emptyVoice} />
        </p>
      )}
    </div>
  );
}
