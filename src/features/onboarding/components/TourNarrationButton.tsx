import { Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { TourNarrationControl } from './useTourNarration';

/**
 * Compact header control for Athena's tour narration. Renders nothing
 * unless narration is available for the current step (i.e. voice is
 * configured and the step has narration text), so the tour stays a plain
 * text coach-mark for users who never set up voice.
 *
 * Two affordances:
 *   - Replay — re-speak the current step (hidden while muted).
 *   - Mute toggle — silence/restore auto-narration for the rest of the tour.
 *     While speaking, the speaker icon pulses.
 */
export function TourNarrationButton({
  control,
  accentTextClass,
}: {
  control: TourNarrationControl;
  /** Tailwind text-color class matching the tour's accent (e.g. `text-violet-400`). */
  accentTextClass: string;
}) {
  const { t } = useTranslation();
  const { available, status, muted, toggleMute, replay } = control;

  if (!available) return null;

  const speaking = status === 'speaking' || status === 'loading';

  return (
    <>
      {!muted && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={replay}
          disabled={status === 'loading'}
          title={t.onboarding.narration_replay}
          aria-label={t.onboarding.narration_replay}
          data-testid="tour-narration-replay"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggleMute}
        title={muted ? t.onboarding.narration_unmute : t.onboarding.narration_mute}
        aria-label={muted ? t.onboarding.narration_unmute : t.onboarding.narration_mute}
        data-testid="tour-narration-mute"
      >
        {muted ? (
          <VolumeX className="w-3.5 h-3.5" />
        ) : (
          <Volume2
            className={`w-3.5 h-3.5 ${speaking ? `${accentTextClass} animate-pulse` : ''}`}
          />
        )}
      </Button>
    </>
  );
}
