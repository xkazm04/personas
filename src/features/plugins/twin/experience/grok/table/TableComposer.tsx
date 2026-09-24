/**
 * The hand at the bottom of the table: typed answer, voice, skip.
 */

import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupVoiceApi } from '../../../setup/setupContract';

interface TableComposerProps {
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  busy: boolean;
  voice: SetupVoiceApi;
}

export function TableComposer({
  draft,
  onDraft,
  onSubmit,
  onSkip,
  busy,
  voice,
}: TableComposerProps) {
  const { t } = useTranslation();
  const xg = t.twin.experience_grok;
  const shown = voice.listening && voice.interim ? voice.interim : draft;

  return (
    <div className={`mt-4 w-full max-w-[52rem] mx-auto ${busy ? 'is-disabled' : ''}`}>
      <ChatInputBar
        value={shown}
        onChange={onDraft}
        onSubmit={onSubmit}
        placeholder={xg.table.composerPlaceholder}
        sendLabel={xg.table.send}
        inputTestId="setup-desk-composer"
        disabled={busy}
        busy={busy}
        multiline
        maxRows={4}
        voice={{
          supported: voice.supported,
          listening: voice.listening,
          onToggle: voice.listening ? voice.stop : voice.start,
          startLabel: xg.voice.dictate,
          listeningLabel: xg.voice.stop,
        }}
      />
      <div className="flex items-center justify-between mt-2 px-1">
        <p className="typo-caption text-primary">
          {xg.table.legendPick} · {xg.table.legendAccept} · {xg.table.legendEdit} · {xg.table.legendSkip}
        </p>
        <Button variant="ghost" size="sm" onClick={onSkip} disabled={busy} data-testid="twin-experience-skip">
          {xg.table.skip}
        </Button>
      </div>
    </div>
  );
}

export default TableComposer;
