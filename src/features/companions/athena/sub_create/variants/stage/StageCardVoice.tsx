import { Check, Play, Square } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  CreateAthenaActions,
  CreateAthenaCard,
  VoiceOption,
} from '../../engine/createAthenaTypes';

/**
 * Voice pick: a two-column grid of voice tiles, each with a play/stop
 * control. The tile itself selects; the play control previews (the first
 * successful play speaks the wake-up line — the engine owns that). While the
 * list loads the grid shows calm ghost tiles under the header, never a
 * spinner; the only spinner here is on the play control that was pressed.
 * "This is her voice" is the card footer's primary (StageCard), enabled by
 * `canNext` once a voice is selected.
 */
type VoiceCard = Extract<CreateAthenaCard, { kind: 'voice_pick' }>;

function GhostTiles() {
  return (
    <div className="grid grid-cols-2 gap-2" aria-hidden="true" data-testid="create-athena-voice-ghost">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-[62px] rounded-card bg-secondary/40 animate-pulse motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function VoiceTile({
  voice,
  card,
  actions,
}: {
  voice: VoiceOption;
  card: VoiceCard;
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.athena;
  const selected = card.selected === voice.voiceId;
  const mine = card.previewVoiceId === voice.voiceId;
  const synth = mine && card.preview === 'synth';
  const playing = mine && card.preview === 'playing';

  return (
    <div
      className={`flex items-center gap-2 rounded-card border p-2.5 pl-3 transition-colors duration-fast motion-reduce:transition-none ${
        selected ? 'border-primary bg-primary/10' : 'border-foreground/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
      data-testid={`create-athena-voice-${voice.voiceId}`}
      data-selected={selected ? 'true' : 'false'}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => actions.selectVoice(voice.voiceId)}
        className="flex-1 min-w-0 text-left focus-ring rounded-interactive"
        data-testid={`create-athena-voice-select-${voice.voiceId}`}
      >
        <span className="flex items-center gap-1.5">
          <span className="typo-label text-foreground truncate">{voice.label}</span>
          {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" aria-label={c.create_voice_selected} />}
        </span>
        {voice.meta && <span className="block typo-caption text-foreground/85 truncate">{voice.meta}</span>}
      </button>
      <Button
        variant={playing ? 'primary' : 'secondary'}
        size="icon-sm"
        loading={synth}
        aria-label={playing ? c.create_voice_stop : c.create_voice_play}
        onClick={() => (playing ? actions.stopPreview() : actions.previewVoice(voice.voiceId))}
        data-testid={`create-athena-voice-play-${voice.voiceId}`}
      >
        {playing ? <Square className="w-3.5 h-3.5" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}
      </Button>
    </div>
  );
}

export function StageCardVoice({ card, actions }: { card: VoiceCard; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.athena;

  return (
    <div className="space-y-3">
      <h3 className="typo-title">{c.create_step_voice_pick}</h3>
      {card.loading && card.voices.length === 0 ? (
        <GhostTiles />
      ) : card.voices.length === 0 ? (
        <p className="typo-body text-foreground/85 py-4" data-testid="create-athena-voice-none">
          {c.create_voice_none}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1" role="radiogroup" aria-label={c.create_step_voice_pick}>
          {card.voices.map((v) => (
            <VoiceTile key={v.voiceId} voice={v} card={card} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}
