/**
 * AthenaChatTurnActions — refine chips + read-aloud under the LATEST completed
 * assistant turn.
 *
 * Split out of the message row so the row can stay `memo`-clean: both of these
 * need the live TTS selection, and `useTtsVoiceSelection()` returns a fresh
 * object every render, which would defeat memoization if it were threaded down
 * as a prop. Only ever one instance is mounted, so reading the hooks here is
 * strictly cheaper.
 */

import { RefineChips } from '../RefineChips';
import { BubbleReadAloud } from '../BubbleReadAloud';
import { useTtsSettings } from '../useTtsSettings';
import { useTtsVoiceSelection } from '../useTtsVoiceSelection';

export function AthenaChatTurnActions({
  content,
  priorUserMessage,
  onSend,
  disabled,
}: {
  /** The assistant reply this row shows — what read-aloud speaks. */
  content: string;
  /** The user message that produced it; empty when there isn't one. */
  priorUserMessage: string;
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const voice = useTtsVoiceSelection();
  const voiceSettings = useTtsSettings();
  const trimmed = content.trim();
  return (
    <>
      {priorUserMessage && (
        <RefineChips
          priorUserMessage={priorUserMessage}
          onSend={onSend}
          disabled={disabled}
        />
      )}
      {trimmed && (
        <BubbleReadAloud content={content} voice={voice} voiceSettings={voiceSettings} />
      )}
    </>
  );
}
