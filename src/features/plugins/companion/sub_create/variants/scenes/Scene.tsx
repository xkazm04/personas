import { useCallback, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { MOTION_PRESETS, REDUCED_FRAMER } from '@/lib/utils/animation/animationPresets';
import { AthenaAvatar } from '@/features/plugins/companion/AthenaAvatar';
import { TypedLine } from '../../shared/TypedLine';
import { AthenaWaveform } from '../../shared/AthenaWaveform';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { SceneCard } from './SceneCard';

const NARROW_MQ =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 640px)')
    : null;

function subscribeNarrow(cb: () => void) {
  NARROW_MQ?.addEventListener('change', cb);
  return () => NARROW_MQ?.removeEventListener('change', cb);
}

/** `typo-hero` needs room; below 640px the line steps down one tier. */
function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => NARROW_MQ?.matches ?? false, () => false);
}

/**
 * One scene of the sequence: Athena's byline, her line typed in, the
 * waveform band while she speaks, and — once the line has landed — the
 * single card for this step. Mounted fresh per line (the parent keys on
 * `engine.line.id`), so the reveal state resets on its own.
 */
export function Scene({ engine }: { engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { shouldAnimate } = useMotion();
  const narrow = useNarrowViewport();
  const [revealed, setRevealed] = useState(false);
  const onLineDone = useCallback(() => setRevealed(true), []);

  return (
    <div className="mx-auto flex h-full w-full max-w-[760px] flex-col justify-center px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <AthenaAvatar state={engine.speaking ? 'speaking' : 'idle'} size={40} />
        <span className="typo-caption">{c.name}</span>
      </div>

      <TypedLine
        lineId={engine.line.id}
        text={engine.line.text}
        onDone={onLineDone}
        className={`${narrow ? 'typo-heading-lg' : 'typo-hero'} text-balance text-foreground`}
      />

      <div className="mt-4 h-6" aria-hidden="true">
        {engine.speaking && <AthenaWaveform active bars={48} className="w-full" />}
      </div>

      <AnimatePresence>
        {revealed && (
          <motion.div
            className="mt-8"
            initial={shouldAnimate ? { opacity: 0, y: 12 } : { opacity: 0 }}
            animate={{ opacity: 1, y: 0 }}
            transition={shouldAnimate ? MOTION_PRESETS.gentle.framer : REDUCED_FRAMER}
          >
            <SceneCard engine={engine} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
