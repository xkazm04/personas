import { Play, Square } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaCard, CreateAthenaEngine, VoiceOption } from '../../engine/createAthenaTypes';

type VoicePickData = Extract<CreateAthenaCard, { kind: 'voice_pick' }>;

const GHOST_ROWS = 4;

/**
 * A short scrollable list of voices. Each row: a select button (label + meta)
 * beside a play/stop control that reflects the engine's preview state.
 * While voices load, calm ghost rows sit under the header — never a spinner.
 */
export function VoicePickCard({ card, engine }: { card: VoicePickData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions } = engine;
  const showGhost = card.loading && card.voices.length === 0;
  const showEmpty = !card.loading && card.voices.length === 0;

  return (
    <>
      <p className="typo-label text-foreground">{c.create_step_voice_pick}</p>
      <div className="max-h-64 overflow-y-auto flex flex-col gap-1 -mx-1 px-1" data-testid="create-athena-voice-list">
        {showGhost &&
          Array.from({ length: GHOST_ROWS }, (_, i) => (
            <div key={i} aria-hidden="true" className="h-11 rounded-interactive bg-secondary/40" />
          ))}
        {showEmpty && (
          <p className="typo-caption text-foreground/85 py-3 text-center" data-testid="create-athena-voice-none">
            {c.create_voice_none}
          </p>
        )}
        {card.voices.map((v) => (
          <VoiceRow key={v.voiceId} voice={v} card={card} engine={engine} />
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          disabled={card.selected === null}
          onClick={actions.next}
          data-testid="create-athena-voice-choose"
        >
          {c.create_voice_choose}
        </Button>
      </div>
    </>
  );
}

function VoiceRow({ voice, card, engine }: { voice: VoiceOption; card: VoicePickData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions } = engine;
  const selected = card.selected === voice.voiceId;
  const isTarget = card.previewVoiceId === voice.voiceId;
  const synthesizing = isTarget && card.preview === 'synth';
  const playing = isTarget && card.preview === 'playing';

  return (
    <div
      className={`flex items-center gap-1 rounded-interactive border pr-1 ${
        selected ? 'border-primary bg-primary/15' : 'border-transparent hover:bg-secondary/60'
      }`}
      data-testid={`create-athena-voice-row-${voice.voiceId}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => actions.selectVoice(voice.voiceId)}
        className="flex-1 min-w-0 text-left px-3 py-2 rounded-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        data-testid={`create-athena-voice-select-${voice.voiceId}`}
      >
        <span className="block typo-body text-foreground truncate">{voice.label}</span>
        {voice.meta && <span className="block typo-caption text-foreground/85 truncate">{voice.meta}</span>}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        loading={synthesizing}
        aria-label={playing ? c.create_voice_stop : c.create_voice_play}
        aria-pressed={playing}
        onClick={() => (playing ? actions.stopPreview() : actions.previewVoice(voice.voiceId))}
        data-testid={`create-athena-voice-${playing ? 'stop' : 'play'}-${voice.voiceId}`}
      >
        {playing ? <Square className="w-3.5 h-3.5" aria-hidden /> : <Play className="w-3.5 h-3.5" aria-hidden />}
      </Button>
    </div>
  );
}
