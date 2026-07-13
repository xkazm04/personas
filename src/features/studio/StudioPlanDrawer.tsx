import { AnimatePresence, motion } from 'framer-motion';
import { ListChecks, X } from 'lucide-react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { PlanGlyph } from './PlanGlyph';
import StudioChecklistStepper from './StudioChecklistStepper';
import type { BuildPhase } from './studioBuildModel';

// The build plan lives in a right-edge drawer instead of a popup over the dock:
// the plan is reference material you read *while* steering, so it should sit
// beside the preview rather than cover the conversation. Opened from the plan
// button in the input row; the dock re-centres itself in the space that's left.
export default function StudioPlanDrawer({
  open,
  onClose,
  phases,
  done,
  total,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  phases: BuildPhase[];
  done: number;
  total: number;
  busy: boolean;
}) {
  const { shouldAnimate } = useMotion();
  const hasPlan = total > 0;
  const pct = hasPlan ? Math.round((done / total) * 100) : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="studio-plan-drawer"
          data-testid="studio-plan-drawer"
          aria-label="Build plan"
          initial={shouldAnimate ? { x: '100%', opacity: 0 } : { opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={shouldAnimate ? { x: '100%', opacity: 0 } : { opacity: 0 }}
          transition={
            shouldAnimate
              ? { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 }
              : { duration: 0.15 }
          }
          className="pointer-events-auto absolute inset-y-0 right-0 z-30 flex w-[min(22rem,45%)] flex-col border-l border-border bg-background shadow-elevation-4"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              <ListChecks className="h-4 w-4 text-primary" />
              {busy && (
                <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-primary/25" />
              )}
            </span>
            <span className="text-md font-medium text-foreground">Build plan</span>
            {hasPlan && (
              <span className="font-mono text-[11px] text-foreground/50">
                {done}/{total}
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close plan"
              className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {hasPlan && (
            <div className="h-0.5 shrink-0 bg-secondary/50">
              <motion.div
                className="h-full bg-primary"
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ duration: shouldAnimate ? 0.5 : 0, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {hasPlan ? (
              <StudioChecklistStepper phases={phases} stagger />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                <PlanGlyph size={88} />
                <p className="typo-caption text-foreground/50">
                  No plan yet — Athena will lay one out as you build.
                </p>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
