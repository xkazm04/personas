import type { CSSProperties } from 'react';
import { Pause, Play, SkipForward, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '../companionStore';
import { resolveWalkthrough } from '../guidance/walkthroughs';
import { ORB_SIZE } from './AthenaOrb';

const CAPTION_GAP = 12;

/**
 * Narration card that rides beside the orb during a guided walkthrough: the
 * current step's text, a step counter, and Pause/Resume · Skip · Stop controls.
 * Positioned from `orbGuideTarget` (the orb's destination) and flipped to
 * whichever side has room, mirroring the orb's own dictation caption. Rendered
 * inside `AthenaGuideLayer`'s body portal; the card opts back into pointer
 * events so its controls are clickable.
 */
export function GuideCaption() {
  const { t, tx } = useTranslation();
  const activeWalkthrough = useCompanionStore((s) => s.activeWalkthrough);
  const stepIndex = useCompanionStore((s) => s.guidanceStepIndex);
  const playing = useCompanionStore((s) => s.guidancePlaying);
  const orbTarget = useCompanionStore((s) => s.orbGuideTarget);
  const adHoc = useCompanionStore((s) => s.adHocWalkthrough);
  const pauseGuidance = useCompanionStore((s) => s.pauseGuidance);
  const resumeGuidance = useCompanionStore((s) => s.resumeGuidance);
  const advanceGuidance = useCompanionStore((s) => s.advanceGuidance);
  const stopGuidance = useCompanionStore((s) => s.stopGuidance);

  const walkthrough = resolveWalkthrough(activeWalkthrough, adHoc);
  if (!walkthrough || !orbTarget) return null;
  const step = walkthrough.steps[stepIndex];
  if (!step) return null;

  const dockedLeft = orbTarget.left + ORB_SIZE / 2 < window.innerWidth / 2;
  const pos: CSSProperties = dockedLeft
    ? { left: orbTarget.left + ORB_SIZE + CAPTION_GAP, top: orbTarget.top }
    : { right: window.innerWidth - orbTarget.left + CAPTION_GAP, top: orbTarget.top };

  const ctrl =
    'w-6 h-6 rounded-full flex items-center justify-center text-foreground/70 hover:bg-secondary focus-ring transition-colors';

  return (
    <div
      data-testid="athena-guide-caption"
      className="pointer-events-auto fixed z-[61] w-[260px] max-w-[80vw] rounded-card bg-background/95 border border-primary/30 shadow-elevation-3 p-3"
      style={pos}
    >
      <p data-testid="athena-guide-caption-text" className="typo-body text-foreground/90">
        {step.narration(t)}
      </p>
      {step.holdForClick && step.highlightTestId && (
        <p data-testid="athena-guide-click-hint" className="mt-1.5 typo-caption text-primary/80">
          {t.plugins.companion.guide_click_hint}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="typo-caption text-foreground">
          {tx(t.plugins.companion.guide_step_label, {
            current: stepIndex + 1,
            total: walkthrough.steps.length,
          })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => (playing ? pauseGuidance() : resumeGuidance())}
            className={ctrl}
            title={playing ? t.plugins.companion.guide_pause : t.plugins.companion.guide_resume}
            aria-label={playing ? t.plugins.companion.guide_pause : t.plugins.companion.guide_resume}
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            data-testid="athena-guide-skip"
            onClick={() => advanceGuidance()}
            className={ctrl}
            title={t.plugins.companion.guide_skip}
            aria-label={t.plugins.companion.guide_skip}
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            data-testid="athena-guide-stop"
            onClick={() => stopGuidance()}
            className={ctrl}
            title={t.plugins.companion.guide_stop}
            aria-label={t.plugins.companion.guide_stop}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
