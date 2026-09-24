/**
 * The blank card: the person's own words. Typed or dictated, it plays like
 * any card. On a `write` turn it is the whole hand — the answer is going to be
 * kept as a writing sample, so it is presented as the reply being written,
 * larger, with the channel it is for.
 *
 * Dictation shows the running transcript while listening and never submits
 * it; only a final transcript, through the voice engine, answers.
 */

import { PenLine } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupAnswerMode, SetupVoiceApi } from '../../../setup/setupContract';
import { channelName } from '../suits';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  voice: SetupVoiceApi;
  answerMode: SetupAnswerMode;
  toneChannel: string | null;
  disabled: boolean;
}

export function Composer({ value, onChange, onSubmit, voice, answerMode, toneChannel, disabled }: ComposerProps) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus.table;
  const write = answerMode === 'write';

  const bar = (
    <ChatInputBar
      value={voice.listening && voice.interim ? voice.interim : value}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder={write ? xo.composerWrite : xo.composerPick}
      sendLabel={xo.send}
      disabled={disabled}
      multiline
      maxRows={write ? 8 : 4}
      inputTestId="xo-composer"
      sendTestId="xo-composer-send"
      voice={{
        supported: voice.supported,
        listening: voice.listening,
        onToggle: voice.listening ? voice.stop : voice.start,
        startLabel: t.twin.setup.voice.dictate,
        listeningLabel: t.twin.setup.voice.stop,
      }}
    />
  );

  if (!write) {
    return <div className="w-full max-w-3xl mx-auto">{bar}</div>;
  }

  return (
    <div
      className="w-full max-w-3xl mx-auto xo-card xo-card-raised xo-foil xo-foil-live xo-suit-tone xo-glow rounded-modal p-4 space-y-3"
      data-testid="xo-composer-card"
    >
      <p className="flex items-center gap-2 typo-title">
        <PenLine className="w-4 h-4 text-[var(--xo-hue)]" aria-hidden />
        {toneChannel && toneChannel !== 'generic'
          ? tx(xo.yourReplyOn, { channel: channelName(toneChannel, '') })
          : xo.yourReply}
      </p>
      {bar}
    </div>
  );
}

export default Composer;
