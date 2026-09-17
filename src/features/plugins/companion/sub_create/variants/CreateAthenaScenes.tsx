import { useEffect, useRef, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import {
  REDUCED_FRAMER,
  TRANSITION_NORMAL,
  TRANSITION_SLOW,
} from '@/lib/utils/animation/animationPresets';
import type { CreateAthenaVariantProps } from '../engine/createAthenaTypes';
import { Scene } from './scenes/Scene';
import { SceneDots } from './scenes/SceneDots';

/** Horizontal travel of a scene change, in px. */
const SLIDE = 24;

/** `custom` is the direction: +1 forward (enter from the right), -1 back. */
const SLIDE_VARIANTS: Variants = {
  enter: (dir: number) => ({ x: SLIDE * dir, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: TRANSITION_SLOW },
  exit: (dir: number) => ({ x: -SLIDE * dir, opacity: 0, transition: TRANSITION_NORMAL }),
};

const FADE_VARIANTS: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: REDUCED_FRAMER },
  exit: { opacity: 0, transition: REDUCED_FRAMER },
};

/** Keys pressed inside a control belong to that control, not to the wizard. */
const CONTROL_SELECTOR = 'input,textarea,select,button,a,[contenteditable="true"]';

/**
 * Create Athena — "Scenes" shell. A title sequence: one full-bleed scene per
 * step inside the page's content box (never `fixed`, never covering the app
 * footer or the orb — both stay visible for the footer_icon / orb steps).
 * Scenes slide horizontally in the direction of travel; the step dots and
 * the four navigation actions are the only chrome.
 */
export default function CreateAthenaScenes({ engine }: CreateAthenaVariantProps) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const { shouldAnimate } = useMotion();
  const { actions, canBack, canNext } = engine;

  // Direction is derived from the step index delta so the exiting scene
  // leaves the way the new one arrives (forward → leftward, back → rightward).
  const prevIndexRef = useRef(engine.stepIndex);
  const direction = engine.stepIndex >= prevIndexRef.current ? 1 : -1;
  useEffect(() => {
    prevIndexRef.current = engine.stepIndex;
  }, [engine.stepIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLElement && e.target.closest(CONTROL_SELECTOR)) return;
    if (e.key === 'ArrowRight' && canNext) {
      e.preventDefault();
      actions.next();
    } else if (e.key === 'ArrowLeft' && canBack) {
      e.preventDefault();
      actions.back();
    }
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-card"
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="create-athena-scenes"
    >
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={engine.line.id}
            className="h-full overflow-y-auto"
            custom={direction}
            variants={shouldAnimate ? SLIDE_VARIANTS : FADE_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <Scene engine={engine} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-4">
        <div className="flex items-center gap-1">
          {canBack && (
            <Button variant="ghost" size="sm" onClick={actions.back} data-testid="create-athena-back">
              {c.create_back}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={actions.restart} data-testid="create-athena-restart">
            {c.create_restart}
          </Button>
        </div>
        <SceneDots
          steps={engine.steps}
          label={tx(c.create_progress, { current: engine.stepIndex + 1, total: engine.stepCount })}
        />
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={actions.skip} data-testid="create-athena-skip">
            {c.create_skip}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canNext}
            onClick={actions.next}
            data-testid="create-athena-next"
          >
            {c.create_next}
          </Button>
        </div>
      </div>
    </div>
  );
}
