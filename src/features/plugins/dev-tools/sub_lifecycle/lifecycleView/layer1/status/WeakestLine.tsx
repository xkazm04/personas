// The status band's lead: the weakest step's sentence in its verdict's ink,
// led by that verdict's glyph (the binding state's lamp in the fallback
// sentence, before anything was measured; a check when every step is
// healthy). A NEW sentence settles in; the first one is simply there (no
// motion on first paint), and under reduced motion every change is instant.
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck } from 'lucide-react';

import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { STATE_TEXT } from '../../../journey/journeyStyles';
import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { BINDING_LOOK } from '../../system/pillLooks';
import { GLYPH } from '../../system/scales';
import { VERDICT } from '../healthModel';
import { HEALTH_GLYPH } from '../layer1Labels';

export function WeakestLine() {
  const { headline, headlineHealth, headlineState, snapshot } = useLifecycleViewModel();
  const reduced = useReducedMotion();
  const allGreen = !headlineHealth && !headlineState && (snapshot?.health.length ?? 0) > 0;
  const ink = headlineHealth ? VERDICT[headlineHealth].ink : headlineState ? STATE_TEXT[headlineState] : allGreen ? 'text-status-success' : '';
  const Glyph = headlineHealth ? HEALTH_GLYPH[headlineHealth] : headlineState ? BINDING_LOOK[headlineState].glyph : allGreen ? CircleCheck : null;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={headline}
        className="flex min-w-0 items-start gap-2.5"
        initial={reduced ? false : { opacity: 0, y: -3 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? undefined : { opacity: 0, transition: { duration: 0.08 } }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      >
        {Glyph && <Glyph className={`${GLYPH.md} mt-1 shrink-0 ${ink}`} aria-hidden />}
        <p className={`${LT.row} ${ink}`} data-testid="lc-weakest" data-health={headlineHealth ?? undefined}>{headline}</p>
      </motion.div>
    </AnimatePresence>
  );
}
