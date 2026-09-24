/**
 * The field, and the one line under it.
 *
 * Dictation lives ON the field rather than in the chrome — it is a way of
 * typing, so it belongs where typing happens (`ChatInputBar`'s own mic slot).
 * The spoken question and hands-free stay beside it as two small toggles,
 * because they are properties of the session and have to remain reachable
 * while a layer is open.
 *
 * The line under the field is the keys and the way out of a question. It is
 * the only place on this surface that lists anything.
 */

import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupAnswerMode, SetupVoiceApi } from '../../../setup/setupContract';

interface ReplyProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  answerMode: SetupAnswerMode;
  busy: boolean;
  voice: SetupVoiceApi;
}

export function Reply({ value, onChange, onSubmit, onSkip, answerMode, busy, voice }: ReplyProps) {
  const { t } = useTranslation();
  const mr = t.twin.experience_mirror.answers;
  const v = t.twin.setup.voice;
  const shown = voice.listening && voice.interim ? voice.interim : value;

  return (
    <div className="space-y-2" data-testid="mr-reply">
      <ChatInputBar
        value={shown}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={answerMode === 'write' ? mr.writePlaceholder : mr.placeholder}
        sendLabel={t.twin.setup.desk.send}
        inputTestId="mr-reply-input"
        sendTestId="mr-reply-send"
        disabled={busy}
        busy={busy}
        multiline
        maxRows={answerMode === 'write' ? 6 : 3}
        voice={
          voice.supported
            ? {
                supported: true,
                listening: voice.listening,
                onToggle: voice.listening ? voice.stop : voice.start,
                startLabel: v.dictate,
                listeningLabel: v.stop,
              }
            : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
        <p className="typo-caption flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="mr-keys">
          <Key cap="1-3" label={mr.keyPick} />
          <Key cap="↵" label={mr.keyPlay} />
          <Key cap="E" label={mr.keyEdit} />
          <Key cap="S" label={mr.keySkip} />
        </p>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={voice.speakEnabled ? 'accent' : 'ghost'}
            accentColor="violet"
            size="icon-sm"
            aria-pressed={voice.speakEnabled}
            aria-label={voice.speakEnabled ? v.speak : v.speakOff}
            onClick={voice.toggleSpeak}
            disabled={!voice.supported}
            disabledReason={v.unsupported}
            icon={voice.speakEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          />
          <AccessibleToggle
            size="sm"
            checked={voice.handsFree}
            onChange={voice.toggleHandsFree}
            label={v.handsFree}
          />
          <Button variant="ghost" size="sm" onClick={onSkip} disabled={busy} data-testid="mr-skip">
            {mr.skip}
          </Button>
        </div>
      </div>
      {voice.error && <p className="px-1 typo-caption text-status-error">{voice.error}</p>}
    </div>
  );
}

function Key({ cap, label }: { cap: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1 rounded-interactive border border-primary/15 bg-secondary/50 typo-label text-foreground tabular-nums">
        {cap}
      </kbd>
      {label}
    </span>
  );
}

export default Reply;
