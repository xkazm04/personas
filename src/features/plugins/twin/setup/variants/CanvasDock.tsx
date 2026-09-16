/**
 * CanvasDock — the conversation, demoted to a tool.
 *
 * On this variant the passport is the subject, so the guide gets a slim rail
 * along one edge carrying exactly three things: the turn it is on, the
 * positions it offers, and a composer. No transcript — the record of what was
 * decided is the card itself, which is the point of the variant.
 *
 * The composer is never disabled while a turn is in flight. The in-flight beat
 * is a bounded ghost where the question will land, under chrome that stays.
 */

import { Wand2 } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupSuggestion, SetupVoiceApi } from '../setupContract';

interface CanvasDockProps {
  question: string | null;
  suggestions: SetupSuggestion[];
  busy: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onPick: (text: string) => void;
  onSkip: () => void;
  voice: SetupVoiceApi;
}

export function CanvasDock({
  question, suggestions, busy, value, onChange, onSubmit, onPick, onSkip, voice,
}: CanvasDockProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;

  return (
    <aside
      data-testid="setup-canvas-dock"
      className="flex-shrink-0 w-full lg:w-[320px] flex flex-col gap-3 border-t lg:border-t-0 lg:border-l border-primary/10 bg-card/40 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
          <Wand2 className="w-3 h-3 text-primary" aria-hidden />
        </span>
        <span className="typo-caption uppercase tracking-[0.18em]">{ts.canvas.dock}</span>
      </div>

      {busy ? (
        <>
          <div aria-hidden className="h-10 rounded-card bg-secondary/40 animate-pulse" />
          <span className="sr-only" role="status">{ts.conversation.thinking}</span>
        </>
      ) : (
        <p className="typo-body text-foreground leading-relaxed" data-testid="setup-canvas-question">
          {question ?? ts.canvas.noQuestion}
        </p>
      )}

      {voice.interim && (
        <p className="typo-caption line-clamp-2" data-testid="setup-canvas-interim">{voice.interim}</p>
      )}

      {!busy && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="setup-canvas-suggestions">
          {suggestions.map((s) => (
            <Tooltip key={s.text} content={s.reason}>
              <button
                type="button"
                onClick={() => onPick(s.text)}
                data-testid="setup-canvas-chip"
                className="px-2.5 py-1 rounded-full border border-primary/20 bg-secondary/40 typo-caption text-foreground transition-colors hover:bg-secondary/70 hover:border-primary/40"
              >
                {s.text}
              </button>
            </Tooltip>
          ))}
        </div>
      )}

      <div className="mt-auto space-y-2">
        <ChatInputBar
          value={value} onChange={onChange} onSubmit={onSubmit} size="sm"
          placeholder={ts.canvas.placeholder} sendAriaLabel={ts.conversation.send}
          sendTestId="setup-canvas-send" inputTestId="setup-canvas-composer"
          voice={{
            supported: voice.supported, listening: voice.listening,
            onToggle: voice.listening ? voice.stop : voice.start,
            startLabel: ts.voice.dictate, listeningLabel: ts.voice.stop,
          }}
        />
        <Button variant="ghost" size="xs" onClick={onSkip} data-testid="setup-canvas-skip">
          {ts.canvas.skip}
        </Button>
      </div>
    </aside>
  );
}

export default CanvasDock;
