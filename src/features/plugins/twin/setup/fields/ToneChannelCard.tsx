/**
 * One channel's voice, whole.
 *
 * A tone row has four parts and the drawer only ever showed one of them, so the
 * examples and the constraints were unreachable without the guide. All four are
 * here, and each one commits on its own: `session.edit` names the part it sets
 * and carries the other three over from the stored row, because the underlying
 * command upserts the row as a unit.
 *
 * The examples and constraints textareas show blank-line separated blocks and
 * store the JSON array the column has always held — `toneParts` is the only
 * place those two representations meet.
 */

import { useTranslation } from '@/i18n/useTranslation';
import type { SetupFieldEdit } from '../setupContract';
import { SetupTextField } from './SetupTextField';
import { blocksOfJson, jsonOfBlocks } from './toneParts';

interface ToneChannelCardProps {
  channel: string;
  values: Partial<Record<string, string>>;
  commit: (change: Omit<SetupFieldEdit, 'value'>) => (value: string) => Promise<void>;
}

export function ToneChannelCard({ channel, values, commit }: ToneChannelCardProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.setup.fields;
  const key = `tone:${channel}`;

  const asBlocks = (raw: string | undefined) => blocksOfJson(raw ?? '');
  const commitBlocks = (part: 'examples' | 'constraints') => {
    const write = commit({ field: 'tone', channel, part });
    return (value: string) => write(jsonOfBlocks(value));
  };

  return (
    <div className="rounded-card border border-primary/12 bg-background/30 p-4 space-y-3">
      <p className="typo-caption uppercase tracking-[0.18em] text-primary/70">
        {tx(ts.toneFor, { channel })}
      </p>

      <SetupTextField
        label={ts.voice}
        slotKey={`tone-${channel}`}
        initial={values[key] ?? ''}
        rows={6}
        helpText={ts.voiceHint}
        edit={commit({ field: 'tone', channel, part: 'voice' })}
      />

      <SetupTextField
        label={ts.examples}
        slotKey={`tone-${channel}-examples`}
        initial={asBlocks(values[`${key}:examples`])}
        rows={5}
        helpText={ts.examplesHint}
        edit={commitBlocks('examples')}
      />

      <SetupTextField
        label={ts.constraints}
        slotKey={`tone-${channel}-constraints`}
        initial={asBlocks(values[`${key}:constraints`])}
        rows={4}
        helpText={ts.constraintsHint}
        edit={commitBlocks('constraints')}
      />

      <SetupTextField
        label={ts.length}
        slotKey={`tone-${channel}-length`}
        initial={values[`${key}:lengthHint`] ?? ''}
        helpText={ts.lengthHelp}
        edit={commit({ field: 'tone', channel, part: 'lengthHint' })}
      />
    </div>
  );
}

export default ToneChannelCard;
