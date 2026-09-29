/**
 * The hand at the bottom of the table: the typed answer, dictation, and the
 * way past a question. Pinned by `CardTable` under the scrolling body — it
 * owns no outer margin.
 *
 * On a `write` turn the composer is the ONLY way to answer (the fan is empty
 * by contract), so it says so rather than offering itself as an alternative to
 * cards that are not there.
 */

import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupAnswerMode, SetupVoiceApi } from '../../setup/setupContract';

interface TableComposerProps {
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  answerMode: SetupAnswerMode;
  busy: boolean;
  voice: SetupVoiceApi;
}

export function TableComposer({
  draft,
  onDraft,
  onSubmit,
  onSkip,
  answerMode,
  busy,
  voice,
}: TableComposerProps) {
  const { t } = useTranslation();
  const tx = t.twin.experience;
  const write = answerMode === 'write';
  const shown = voice.listening && voice.interim ? voice.interim : draft;

  return (
    <div className={`w-full max-w-[52rem] mx-auto ${busy ? 'is-disabled' : ''}`}>
      <ChatInputBar
        value={shown}
        onChange={onDraft}
        onSubmit={onSubmit}
        placeholder={write ? tx.table.writePlaceholder : tx.table.composerPlaceholder}
        sendLabel={tx.table.send}
        inputTestId="setup-desk-composer"
        disabled={busy}
        busy={busy}
        multiline
        maxRows={write ? 6 : 4}
        voice={{
          supported: voice.supported,
          listening: voice.listening,
          onToggle: voice.listening ? voice.stop : voice.start,
          startLabel: tx.dictation.dictate,
          listeningLabel: tx.dictation.stop,
        }}
      />
      <div className="flex items-center justify-between gap-3 mt-2 px-1">
        <p className="typo-caption min-w-0 truncate">
          {write
            ? tx.table.writeHint
            : `${tx.table.legendPick} · ${tx.table.legendAccept} · ${tx.table.legendEdit} · ${tx.table.legendSkip}`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkip}
          disabled={busy}
          className="flex-shrink-0"
          data-testid="twin-experience-skip"
        >
          {tx.table.skip}
        </Button>
      </div>
    </div>
  );
}

export default TableComposer;
