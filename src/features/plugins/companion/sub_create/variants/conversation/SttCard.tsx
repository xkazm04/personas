import type { KeyboardEvent } from 'react';
import { Mic } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { SttEngineId } from '@/api/companion';
import type { EngineTake } from '@/features/plugins/companion/useSttComparison';
import { MicLevelMeter } from '../../shared/MicLevelMeter';
import type { CreateAthenaCard, CreateAthenaEngine } from '../../engine/createAthenaTypes';

type SttData = Extract<CreateAthenaCard, { kind: 'stt' }>;

/**
 * Hold-to-talk (pointer hold, or Space to toggle from the keyboard), the live
 * mic meter, then the two transcriptions side by side — each with its own
 * "Hear me this way" so the user picks the engine that heard them best.
 */
export function SttCard({ card, engine }: { card: SttData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions, canNext } = engine;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ') return;
    e.preventDefault();
    if (card.recording) actions.sttStop();
    else actions.sttStart();
  };

  return (
    <>
      {card.micError && (
        <p className="typo-caption text-destructive" role="alert" data-testid="create-athena-stt-mic-error">
          {card.micError}
        </p>
      )}
      <div className="flex flex-col items-center gap-2">
        <Button
          variant={card.recording ? 'primary' : 'secondary'}
          size="lg"
          icon={<Mic className="w-4 h-4" aria-hidden />}
          aria-pressed={card.recording}
          disabled={card.busy && !card.recording}
          onPointerDown={() => actions.sttStart()}
          onPointerUp={() => actions.sttStop()}
          onPointerLeave={() => card.recording && actions.sttStop()}
          onKeyDown={onKeyDown}
          data-testid="create-athena-stt-hold"
        >
          {card.recording ? c.create_stt_release : c.create_stt_hold}
        </Button>
        <MicLevelMeter active={card.recording} className="w-48" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TakeColumn id="browser" title={c.create_stt_browser} take={card.browser} enabled card={card} onPick={actions.sttPick} />
        <TakeColumn
          id="whisper"
          title={c.create_stt_whisper}
          take={card.whisper}
          enabled={card.whisperInstalled}
          card={card}
          onPick={actions.sttPick}
        />
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={!canNext} onClick={actions.next} data-testid="create-athena-next">
          {c.create_next}
        </Button>
      </div>
    </>
  );
}

function TakeColumn({
  id,
  title,
  take,
  enabled,
  card,
  onPick,
}: {
  id: SttEngineId;
  title: string;
  take: EngineTake;
  enabled: boolean;
  card: SttData;
  onPick: (id: SttEngineId) => void;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const picked = card.picked === id;
  const text = take.text || take.interim;
  const usable = enabled && take.supported;

  return (
    <div
      className={`flex flex-col gap-2 rounded-interactive border p-2.5 ${
        picked ? 'border-primary bg-primary/15' : 'border-foreground/10 bg-background/60'
      } ${usable ? '' : 'opacity-60'}`}
      data-testid={`create-athena-stt-col-${id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="typo-label text-foreground">{title}</span>
        {take.elapsedMs !== null && (
          <span className="typo-data text-foreground/85 rounded-pill bg-secondary/60 px-1.5">
            {tx(c.create_stt_latency, { ms: take.elapsedMs })}
          </span>
        )}
      </div>
      <p className="typo-body text-foreground min-h-10 break-words" data-testid={`create-athena-stt-text-${id}`}>
        {!enabled
          ? c.create_stt_not_installed
          : !take.supported
            ? c.create_stt_unsupported
            : text || <span className="text-foreground/85">{c.create_stt_empty}</span>}
      </p>
      <Button
        variant={picked ? 'primary' : 'secondary'}
        size="xs"
        aria-pressed={picked}
        disabled={!usable || !take.text}
        onClick={() => onPick(id)}
        data-testid={`create-athena-stt-use-${id}`}
      >
        {c.create_stt_use}
      </Button>
    </div>
  );
}
