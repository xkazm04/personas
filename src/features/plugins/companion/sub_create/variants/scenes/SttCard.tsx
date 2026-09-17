import { Mic } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { CSS_DURATION_CLASS } from '@/lib/utils/animation/animationPresets';
import type { SttEngineId } from '@/api/companion';
import type { EngineTake } from '@/features/plugins/companion/useSttComparison';
import { MicLevelMeter } from '../../shared/MicLevelMeter';
import type { CreateAthenaActions, CreateAthenaCard } from '../../engine/createAthenaTypes';

type Stt = Extract<CreateAthenaCard, { kind: 'stt' }>;

function TakePanel({
  id,
  title,
  take,
  note,
  disabled,
  picked,
  onPick,
}: {
  id: SttEngineId;
  title: string;
  take: EngineTake;
  /** Replaces the transcript when the engine cannot run here. */
  note: string | null;
  disabled: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const transcript = take.error ?? note ?? (take.text || take.interim || null);
  const dim = !take.text && !take.error && !note;

  return (
    <div
      className={`flex flex-1 flex-col gap-2 rounded-card border p-4 ${
        picked ? 'border-primary/40 bg-primary/5' : 'border-border bg-secondary/20'
      } ${disabled ? 'opacity-60' : ''}`}
      data-testid={`create-athena-stt-${id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="typo-title-lg text-foreground">{title}</span>
        {take.elapsedMs !== null && (
          <span className="typo-data" data-testid={`create-athena-stt-latency-${id}`}>
            {tx(c.create_stt_latency, { ms: take.elapsedMs })}
          </span>
        )}
      </div>
      <p
        className={`typo-body min-h-10 ${take.error ? 'text-status-error' : dim ? 'text-muted' : 'text-foreground'}`}
        data-testid={`create-athena-stt-text-${id}`}
      >
        {transcript ?? c.create_stt_empty}
      </p>
      <div>
        <Button
          variant={picked ? 'primary' : 'secondary'}
          size="sm"
          disabled={disabled || !take.text}
          onClick={onPick}
          data-testid={`create-athena-stt-use-${id}`}
        >
          {c.create_stt_use}
        </Button>
      </div>
    </div>
  );
}

/**
 * stt — hold the circle to talk, watch the mic meter, then compare the two
 * transcripts and pick the engine that heard you best.
 */
export function SttCard({ card, actions }: { card: Stt; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !card.recording) {
      e.preventDefault();
      actions.sttStart();
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === ' ' || e.key === 'Enter') && card.recording) {
      e.preventDefault();
      actions.sttStop();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {card.micError && (
        <p className="typo-body text-status-error" data-testid="create-athena-stt-mic-error">
          {card.micError}
        </p>
      )}

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          aria-pressed={card.recording}
          disabled={card.busy && !card.recording}
          onPointerDown={actions.sttStart}
          onPointerUp={actions.sttStop}
          onPointerLeave={card.recording ? actions.sttStop : undefined}
          onPointerCancel={actions.sttStop}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          className={`flex h-28 w-28 select-none touch-none flex-col items-center justify-center gap-1 rounded-full border-2 transition-colors ${CSS_DURATION_CLASS.snappy} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:is-disabled ${
            card.recording
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-secondary/30 text-foreground hover:border-primary/40'
          }`}
          data-testid="create-athena-stt-hold"
        >
          <Mic className="h-7 w-7" aria-hidden="true" />
          <span className="typo-label">{card.recording ? c.create_stt_release : c.create_stt_hold}</span>
        </button>
        <MicLevelMeter active={card.recording} className="w-48" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <TakePanel
          id="browser"
          title={c.create_stt_browser}
          take={card.browser}
          note={card.browser.supported ? null : c.create_stt_unsupported}
          disabled={!card.browser.supported}
          picked={card.picked === 'browser'}
          onPick={() => actions.sttPick('browser')}
        />
        <TakePanel
          id="whisper"
          title={c.create_stt_whisper}
          take={card.whisper}
          note={
            !card.whisperInstalled
              ? c.create_stt_not_installed
              : card.whisper.supported
                ? null
                : c.create_stt_unsupported
          }
          disabled={!card.whisperInstalled || !card.whisper.supported}
          picked={card.picked === 'whisper'}
          onPick={() => actions.sttPick('whisper')}
        />
      </div>
    </div>
  );
}
