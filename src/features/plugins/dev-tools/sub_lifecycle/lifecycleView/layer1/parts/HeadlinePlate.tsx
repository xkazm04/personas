// The headline as a raised label plate with an indicator lamp (Tactile, kept
// from the 2026-10-06 round). It carries the named step's own verdict ink:
// the measured verdict when the snapshot has health, the binding state in the
// fallback sentence. A new sentence settles onto the plate with a spring.
import { AnimatePresence, motion } from 'framer-motion';

import type { LifecycleBindingState } from '@/lib/bindings/LifecycleBindingState';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import { STATE_TEXT } from '../../../journey/journeyStyles';
import { useLifecycleViewModel } from '../../context';
import { VERDICT } from '../healthModel';

const STATE_LAMP: Record<LifecycleBindingState, string> = {
  live: 'bg-status-success ring-status-success/20',
  detected: 'bg-status-info ring-status-info/20',
  pending: 'bg-status-warning ring-status-warning/20',
  missing: 'bg-status-error ring-status-error/20',
  advisory: 'bg-foreground/50 ring-foreground/10',
};

/** Only the verdicts a headline can name; an unmeasured lamp is a dashed ring, never a dim fill. */
const HEALTH_LAMP: Partial<Record<LifecycleHealth, string>> = {
  red: 'bg-status-error ring-status-error/20',
  stale: 'bg-status-info ring-status-info/20',
  amber: 'bg-status-warning ring-status-warning/20',
  unmeasured: 'border-2 border-dashed border-foreground/60 ring-transparent',
};

export function HeadlinePlate() {
  const { headline, headlineHealth, headlineState } = useLifecycleViewModel();
  const ink = headlineHealth ? VERDICT[headlineHealth].ink : headlineState ? STATE_TEXT[headlineState] : 'text-foreground';
  const lamp = headlineHealth ? HEALTH_LAMP[headlineHealth] : headlineState ? STATE_LAMP[headlineState] : undefined;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={headline}
        className="mx-auto flex w-fit max-w-full items-center gap-3 rounded-card border border-primary/15 bg-gradient-to-b from-secondary/50 to-secondary/20 px-4 py-2.5 shadow-elevation-1"
        initial={{ opacity: 0, scale: 0.97, y: -3 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      >
        {lamp && <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${lamp}`} />}
        <p className={`typo-body-lg ${ink}`} data-testid="lc-weakest" data-health={headlineHealth ?? undefined}>{headline}</p>
      </motion.div>
    </AnimatePresence>
  );
}
