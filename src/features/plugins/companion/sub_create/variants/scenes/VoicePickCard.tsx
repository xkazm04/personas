import { Play, Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { CSS_DURATION_CLASS } from '@/lib/utils/animation/animationPresets';
import type { CreateAthenaActions, CreateAthenaCard, VoiceOption } from '../../engine/createAthenaTypes';

type VoicePick = Extract<CreateAthenaCard, { kind: 'voice_pick' }>;

const GHOST_COUNT = 4;

function VoiceChip({
  voice,
  selected,
  preview,
  actions,
}: {
  voice: VoiceOption;
  selected: boolean;
  preview: 'idle' | 'synth' | 'playing';
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const playing = preview === 'playing';
  return (
    <div
      className={`flex shrink-0 items-center gap-2 rounded-card border py-2 pl-3 pr-2 transition-colors ${CSS_DURATION_CLASS.snappy} ${
        selected ? 'border-primary/40 bg-primary/5' : 'border-border bg-secondary/20 hover:bg-secondary/40'
      }`}
      data-testid={`create-athena-voice-${voice.voiceId}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => actions.selectVoice(voice.voiceId)}
        className="flex min-w-24 flex-col items-start text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-interactive"
        data-testid={`create-athena-voice-select-${voice.voiceId}`}
      >
        <span className="typo-title-lg text-foreground">{voice.label}</span>
        {voice.meta && <span className="typo-caption">{voice.meta}</span>}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        loading={preview === 'synth'}
        aria-label={playing ? c.create_voice_stop : c.create_voice_play}
        onClick={() => (playing ? actions.stopPreview() : actions.previewVoice(voice.voiceId))}
        icon={playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        data-testid={`create-athena-voice-play-${voice.voiceId}`}
      />
    </div>
  );
}

/**
 * voice_pick — a horizontal strip of voices, each with its own play/stop.
 * While the list loads, calm ghost chips hold the strip's geometry (no
 * spinner — a surface never spins); an empty list says so in one line.
 */
export function VoicePickCard({ card, actions }: { card: VoicePick; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const ghosting = card.loading && card.voices.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2" data-testid="create-athena-voice-strip">
        {ghosting &&
          Array.from({ length: GHOST_COUNT }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="h-14 w-36 shrink-0 rounded-card bg-secondary/30"
              data-testid="create-athena-voice-ghost"
            />
          ))}
        {!ghosting && card.voices.length === 0 && (
          <p className="typo-caption" data-testid="create-athena-voice-none">
            {c.create_voice_none}
          </p>
        )}
        {card.voices.map((voice) => (
          <VoiceChip
            key={voice.voiceId}
            voice={voice}
            selected={card.selected === voice.voiceId}
            preview={card.previewVoiceId === voice.voiceId ? card.preview : 'idle'}
            actions={actions}
          />
        ))}
      </div>
      <div>
        <Button
          variant="primary"
          size="lg"
          disabled={!card.selected}
          onClick={actions.next}
          data-testid="create-athena-voice-choose"
        >
          {c.create_voice_choose}
        </Button>
      </div>
    </div>
  );
}
