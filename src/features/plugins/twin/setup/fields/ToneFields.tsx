/**
 * The Tone section's body: one card per channel the twin actually has.
 *
 * The channel list is `session.toneChannels` — 'generic' plus every BOUND
 * channel type — so the page offers registers for the channels this twin owns
 * and no others. Two columns once there is room for them, one when there is
 * not: a tone card is four fields tall and two of them are paragraphs.
 */

import type { SetupFieldEdit } from '../setupContract';
import { ToneChannelCard } from './ToneChannelCard';

interface ToneFieldsProps {
  channels: string[];
  values: Partial<Record<string, string>>;
  commit: (change: Omit<SetupFieldEdit, 'value'>) => (value: string) => Promise<void>;
}

export function ToneFields({ channels, values, commit }: ToneFieldsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {channels.map((channel) => (
        <ToneChannelCard key={channel} channel={channel} values={values} commit={commit} />
      ))}
    </div>
  );
}

export default ToneFields;
