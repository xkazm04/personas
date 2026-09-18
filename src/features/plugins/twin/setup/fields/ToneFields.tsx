/**
 * The Tone section's body: one card per channel the twin actually has.
 *
 * The channel list is `session.toneChannels` — 'generic' plus every BOUND
 * channel type — so the page offers registers for the channels this twin owns
 * and no others. Two columns once there is room for them, one when there is
 * not: a tone card is four fields tall and two of them are paragraphs.
 *
 * The Style studio sits above the cards: it writes the same rows, and each
 * card shows which style (if any) its row came from.
 */

import { useMemo } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import type { SetupFieldEdit } from '../setupContract';
import { StylePanel } from '../style/StylePanel';
import { ToneChannelCard } from './ToneChannelCard';

interface ToneFieldsProps {
  channels: string[];
  values: Partial<Record<string, string>>;
  commit: (change: Omit<SetupFieldEdit, 'value'>) => (value: string) => Promise<void>;
}

export function ToneFields({ channels, values, commit }: ToneFieldsProps) {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const twinTones = useSystemStore((s) => s.twinTones);
  // `values` carries the four editable parts; `style_json` is read-only
  // provenance, so it is read from the same slice rows the session reads.
  const styleByChannel = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const tone of twinTones) {
      if (tone.twin_id === activeTwinId) out.set(tone.channel, tone.style_json);
    }
    return out;
  }, [activeTwinId, twinTones]);

  return (
    <div className="space-y-4">
      <StylePanel channels={channels} />
      <div className="grid gap-4 xl:grid-cols-2">
        {channels.map((channel) => (
          <ToneChannelCard
            key={channel}
            channel={channel}
            values={values}
            commit={commit}
            styleJson={styleByChannel.get(channel) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

export default ToneFields;
