import type { CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronLeft, Pause, Play, SkipForward, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useCompanionStore } from '../companionStore';
import { resolveWalkthrough } from '../guidance/walkthroughs';
import { ORB_SIZE } from './AthenaOrb';

const CAPTION_GAP = 12;

/**
 * Narration card that rides beside the orb during a guided walkthrough: the
 * current step's text, a segmented progress rail (each segment jumps to its
 * step), and Back · Pause/Resume · Skip · Stop controls. A small primary tail
 * points back toward the orb. Positioned from `orbGuideTarget` (the orb's
 * destination) and flipped to whichever side has room. Rendered inside
 * `AthenaGuideLayer`'s body portal; the card opts back into pointer events so
 * its controls are clickable.
 *
 * A single-step ad-hoc walkthrough (`point_at`) collapses to just the narration
 * + dismiss — no rail, no Back/Skip (there's nowhere to step).
 */
export function GuideCaption() {
  const { t, tx } = useTranslation();
  const reduceMotion = useReducedMotion();
  const activeWalkthrough = useCompanionStore((s) => s.activeWalkthrough);
  const stepIndex = useCompanionStore((s) => s.guidanceStepIndex);
  const playing = useCompanionStore((s) => s.guidancePlaying);
  const orbTarget = useCompanionStore((s) => s.orbGuideTarget);
  const adHoc = useCompanionStore((s) => s.adHocWalkthrough);
  const pauseGuidance = useCompanionStore((s) => s.pauseGuidance);
  const resumeGuidance = useCompanionStore((s) => s.resumeGuidance);
  const advanceGuidance = useCompanionStore((s) => s.advanceGuidance);
  const previousGuidance = useCompanionStore((s) => s.previousGuidance);
  const jumpToStep = useCompanionStore((s) => s.jumpToStep);
  const stopGuidance = useCompanionStore((s) => s.stopGuidance);

  const walkthrough = resolveWalkthrough(activeWalkthrough, adHoc);
  if (!walkthrough || !orbTarget) return null;
  const step = walkthrough.steps[stepIndex];
  if (!step) return null;

  const total = walkthrough.steps.length;
  const isMulti = total > 1;

  const dockedLeft = orbTarget.left + ORB_SIZE / 2 < window.innerWidth / 2;
  const pos: CSSProperties = dockedLeft
    ? { left: orbTarget.left + ORB_SIZE + CAPTION_GAP, top: orbTarget.top }
    : { right: window.innerWidth - orbTarget.left + CAPTION_GAP, top: orbTarget.top };

  // A primary tail pointing back at the orb (echoes the ring's accent colour).
  const tail: CSSProperties = dockedLeft
    ? { left: -7, top: 18, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderRight: '7px solid var(--color-primary)' }
    : { right: -7, top: 18, borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '7px solid var(--color-primary)' };

  const ctrl =
    'w-6 h-6 rounded-full flex items-center justify-center text-foreground/70 hover:bg-secondary focus-ring transition-colors disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <div
      data-testid="athena-guide-caption"
      className="pointer-events-auto fixed z-[61] w-[260px] max-w-[80vw] rounded-card bg-background/95 border border-primary/30 shadow-elevation-3 p-3"
      style={pos}
    >
      <span className="pointer-events-none absolute h-0 w-0" style={tail} aria-hidden />

      <motion.p
        key={stepIndex}
        data-testid="athena-guide-caption-text"
        initial={reduceMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        className="typo-body text-foreground/90"
      >
        {step.narration(t)}
      </motion.p>

      {step.holdForClick && step.highlightTestId && (
        <p data-testid="athena-guide-click-hint" className="mt-1.5 typo-caption text-primary/80">
          {t.plugins.companion.guide_click_hint}
        </p>
      )}

      {/* Segmented progress rail — each segment jumps to its step. */}
      {isMulti && (
        <div className="mt-2.5 flex items-center gap-1" role="group">
          <span className="sr-only">
            {tx(t.plugins.companion.guide_step_label, { current: stepIndex + 1, total })}
          </span>
          {walkthrough.steps.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpToStep(i)}
              aria-label={tx(t.plugins.companion.guide_goto_step, { step: i + 1 })}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={`h-1.5 flex-1 rounded-full focus-ring transition-colors ${
                i === stepIndex
                  ? 'bg-primary'
                  : i < stepIndex
                    ? 'bg-primary/50'
                    : 'bg-secondary hover:bg-primary/30'
              }`}
            />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        {isMulti ? (
          <button
            type="button"
            data-testid="athena-guide-back"
            onClick={() => previousGuidance()}
            disabled={stepIndex === 0}
            className={ctrl}
            title={t.plugins.companion.guide_back}
            aria-label={t.plugins.companion.guide_back}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-1">
          {isMulti && (
            <button
              type="button"
              onClick={() => (playing ? pauseGuidance() : resumeGuidance())}
              className={ctrl}
              title={playing ? t.plugins.companion.guide_pause : t.plugins.companion.guide_resume}
              aria-label={playing ? t.plugins.companion.guide_pause : t.plugins.companion.guide_resume}
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
          )}
          {isMulti && (
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
          )}
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
