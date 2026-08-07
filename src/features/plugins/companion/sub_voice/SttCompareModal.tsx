import { Cloud, HardDrive, Mic, RotateCcw, Square } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useSttComparison, type EngineTake } from '../useSttComparison';

/**
 * A/B bench for the two speech-to-text engines: one spoken take, both
 * transcripts side by side, on the operator's own microphone and room.
 *
 * Deliberately ephemeral — nothing is saved. Say a sentence, read the two
 * columns, decide which engine to keep, close. Built from the shared
 * primitives (BaseModal / Button / CopyButton / ErrorBanner /
 * LoadingSpinner) so it inherits the app's look rather than inventing one.
 */
export function SttCompareModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const modelId = useSystemStore((s) => s.companionSttModelId);
  const cmp = useSttComparison();

  const close = () => {
    cmp.stop();
    onClose();
  };

  return (
    <BaseModal isOpen={isOpen} onClose={close} titleId="stt-compare-title" size="lg" portal>
      <div className="p-6 space-y-4">
        <div>
          <h2 id="stt-compare-title" className="typo-heading-lg text-foreground">
            {c.stt_compare_title}
          </h2>
          <p className="typo-caption text-foreground mt-1">{c.stt_compare_hint}</p>
        </div>

        {/* Toolbar: record / stop, reset. */}
        <div className="flex items-center gap-2 rounded-card border border-foreground/10 bg-secondary/20 px-3 py-2">
          {cmp.recording ? (
            <Button
              variant="danger"
              onClick={cmp.stop}
              icon={<Square className="w-4 h-4" />}
              data-testid="stt-compare-stop"
            >
              {c.stt_compare_stop}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={cmp.start}
              icon={<Mic className="w-4 h-4" />}
              disabled={cmp.busy}
              data-testid="stt-compare-record"
            >
              {c.stt_compare_record}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={cmp.reset}
            icon={<RotateCcw className="w-4 h-4" />}
            disabled={cmp.recording || !cmp.hasResult}
            data-testid="stt-compare-reset"
          >
            {c.stt_compare_reset}
          </Button>
          <div className="flex-1" />
          <span className="typo-caption text-foreground" data-testid="stt-compare-status">
            {cmp.recording
              ? c.stt_compare_listening
              : cmp.busy
                ? c.stt_compare_working
                : cmp.hasResult
                  ? c.stt_compare_done
                  : c.stt_compare_idle}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <EngineColumn
            testId="browser"
            icon={<Cloud className="w-4 h-4" />}
            label={c.stt_engine_browser}
            take={cmp.browser}
            unsupportedNote={c.stt_compare_browser_unsupported}
            emptyNote={c.stt_compare_empty}
            latencyLabel={(ms) => tx(c.stt_compare_latency, { ms })}
          />
          <EngineColumn
            testId="whisper"
            icon={<HardDrive className="w-4 h-4" />}
            label={c.stt_engine_whisper}
            take={cmp.whisper}
            // The one setup gap worth naming before the engine reports a
            // raw `no_model_selected`: whisper needs a downloaded model.
            unsupportedNote={modelId ? c.stt_compare_whisper_unsupported : c.stt_compare_no_model}
            emptyNote={c.stt_compare_empty}
            latencyLabel={(ms) => tx(c.stt_compare_latency, { ms })}
          />
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={close}>
            {t.common.close}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}

interface EngineColumnProps {
  testId: string;
  icon: React.ReactNode;
  label: string;
  take: EngineTake;
  unsupportedNote: string;
  emptyNote: string;
  latencyLabel: (ms: number) => string;
}

function EngineColumn({
  testId,
  icon,
  label,
  take,
  unsupportedNote,
  emptyNote,
  latencyLabel,
}: EngineColumnProps) {
  // Interim only ever fills for the browser engine (whisper is batch), which
  // is itself part of what the comparison shows: one streams, one waits.
  const body = take.text || take.interim;

  return (
    <div
      className="flex flex-col rounded-card border border-foreground/10 bg-secondary/20 p-3 min-h-48"
      data-testid={`stt-compare-col-${testId}`}
    >
      <div className="flex items-center gap-2 pb-2 border-b border-foreground/10">
        <span className="text-foreground">{icon}</span>
        <span className="typo-body font-medium text-foreground">{label}</span>
        <div className="flex-1" />
        {take.busy && <LoadingSpinner size="sm" />}
        {!take.busy && take.elapsedMs !== null && (
          <span className="typo-caption text-foreground tabular-nums">
            {latencyLabel(take.elapsedMs)}
          </span>
        )}
        {take.text && <CopyButton text={take.text} />}
      </div>

      <div className="flex-1 pt-2">
        {!take.supported ? (
          <p className="typo-caption text-amber-300">{unsupportedNote}</p>
        ) : take.error ? (
          <ErrorBanner message={take.error} variant="inline" />
        ) : body ? (
          <p
            className={`typo-body whitespace-pre-wrap ${
              take.text ? 'text-foreground' : 'text-foreground italic'
            }`}
            data-testid={`stt-compare-text-${testId}`}
          >
            {body}
          </p>
        ) : (
          <p className="typo-caption text-foreground">{emptyNote}</p>
        )}
      </div>
    </div>
  );
}
