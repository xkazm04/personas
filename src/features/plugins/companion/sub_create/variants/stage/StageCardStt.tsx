import { AlertTriangle, Mic } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { SttEngineId } from '@/api/companion';
import type { EngineTake } from '@/features/plugins/companion/useSttComparison';
import type { CreateAthenaActions, CreateAthenaCard } from '../../engine/createAthenaTypes';
import { MicLevelMeter } from '../../shared/MicLevelMeter';

/**
 * The dual-engine take: hold to talk, watch the level, compare what the
 * browser and Whisper each heard, pick the one that heard you best.
 */
type SttCard = Extract<CreateAthenaCard, { kind: 'stt' }>;

function SttColumn({
  id,
  take,
  recording,
  picked,
  installed,
  onPick,
}: {
  id: SttEngineId;
  take: EngineTake;
  recording: boolean;
  picked: boolean;
  installed: boolean;
  onPick: () => void;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const usable = take.supported && installed;
  const heard = take.text || take.interim;
  const body = !take.supported
    ? c.create_stt_unsupported
    : !installed
      ? c.create_stt_not_installed
      : heard || (recording ? c.create_stt_listening : c.create_stt_empty);

  return (
    <div
      className={`flex flex-col gap-2 rounded-card border p-3 min-h-[120px] ${
        picked ? 'border-primary bg-primary/10' : 'border-foreground/10 bg-secondary/20'
      } ${usable ? '' : 'opacity-60'}`}
      data-testid={`create-athena-stt-col-${id}`}
      data-picked={picked ? 'true' : 'false'}
    >
      <div className="flex items-center gap-2">
        <span className="typo-label text-foreground">
          {id === 'browser' ? c.create_stt_browser : c.create_stt_whisper}
        </span>
        {take.elapsedMs !== null && (
          <span className="ml-auto inline-flex items-center px-1.5 py-px rounded-pill bg-secondary/60 typo-caption text-foreground/85 tabular-nums">
            {tx(c.create_stt_latency, { ms: take.elapsedMs })}
          </span>
        )}
      </div>
      <p
        className={`flex-1 typo-body ${heard ? 'text-foreground' : 'text-foreground/85'} ${
          take.busy && !heard ? 'animate-pulse motion-reduce:animate-none' : ''
        }`}
        data-testid={`create-athena-stt-text-${id}`}
      >
        {take.error ?? body}
      </p>
      <Button
        variant={picked ? 'primary' : 'secondary'}
        size="xs"
        disabled={!usable}
        aria-pressed={picked}
        onClick={onPick}
        data-testid={`create-athena-stt-use-${id}`}
      >
        {c.create_stt_use}
      </Button>
    </div>
  );
}

export function StageCardStt({ card, actions }: { card: SttCard; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;

  return (
    <div className="space-y-4">
      {card.micError && (
        <p className="flex items-start gap-2 typo-caption text-foreground" data-testid="create-athena-stt-mic-error">
          <AlertTriangle className="w-4 h-4 shrink-0 text-status-warning" aria-hidden="true" />
          <span>{card.micError}</span>
        </p>
      )}
      <div className="flex items-center gap-4">
        <Button
          variant={card.recording ? 'primary' : 'secondary'}
          size="lg"
          icon={<Mic className="w-4 h-4" aria-hidden="true" />}
          aria-pressed={card.recording}
          onPointerDown={actions.sttStart}
          onPointerUp={actions.sttStop}
          onPointerLeave={card.recording ? actions.sttStop : undefined}
          onPointerCancel={actions.sttStop}
          disabled={card.busy && !card.recording}
          data-testid="create-athena-stt-hold"
        >
          {card.recording ? c.create_stt_release : c.create_stt_hold}
        </Button>
        <MicLevelMeter active={card.recording} className="flex-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SttColumn
          id="browser"
          take={card.browser}
          recording={card.recording}
          picked={card.picked === 'browser'}
          installed
          onPick={() => actions.sttPick('browser')}
        />
        <SttColumn
          id="whisper"
          take={card.whisper}
          recording={card.recording}
          picked={card.picked === 'whisper'}
          installed={card.whisperInstalled}
          onPick={() => actions.sttPick('whisper')}
        />
      </div>
    </div>
  );
}
