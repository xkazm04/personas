import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ListChecks } from 'lucide-react';
import { MOCK_PHASES, phaseProgress, type BuildPhase } from './studioBuildModel';
import StudioChecklistStepper from './StudioChecklistStepper';

// Right-docked build-checklist drawer: a thin always-visible edge tab that flies
// out a CONTENT-SIZED panel (the Stepper) — sized to its phases, no full-height
// dead space. Auto-expands when progress is made, auto-hides after 10s of no
// interaction; both animated. Phases are mocked until the build_plan op (P3).

const AUTO_HIDE_MS = 10_000;

export default function StudioChecklist({ phases = MOCK_PHASES }: { phases?: BuildPhase[] }) {
  const [expanded, setExpanded] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const { done, total } = phaseProgress(phases);

  const cancelHide = () => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setExpanded(false), AUTO_HIDE_MS);
  };

  // Auto-expand whenever progress is made (the done count changes).
  const prevDone = useRef(done);
  useEffect(() => {
    if (done !== prevDone.current) {
      prevDone.current = done;
      setExpanded(true);
      scheduleHide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  useEffect(() => () => cancelHide(), []);

  const toggle = () => {
    if (expanded) {
      setExpanded(false);
      cancelHide();
    } else {
      setExpanded(true);
      scheduleHide();
    }
  };

  return (
    <div className="absolute right-0 top-3 z-20 flex items-start gap-1.5">
      <AnimatePresence>
        {expanded && (
          <motion.aside
            initial={{ x: 16, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            className="flex max-h-[70vh] w-64 flex-col overflow-hidden rounded-card border border-border bg-background/95 shadow-elevation-4 backdrop-blur"
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <ListChecks className="h-4 w-4 shrink-0 text-primary" />
              <span className="typo-caption flex-1 text-foreground">
                Build plan · {done}/{total}
              </span>
            </header>
            {/* ~4 phases visible; the rest scroll (plans can get long). */}
            <div className="max-h-52 overflow-y-auto p-3">
              <StudioChecklistStepper phases={phases} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={toggle}
        aria-label="Build checklist"
        aria-expanded={expanded}
        className="flex w-8 shrink-0 flex-col items-center gap-1.5 rounded-l-card border border-r-0 border-border bg-background/90 py-2.5 text-foreground/70 shadow-elevation-2 backdrop-blur transition-colors hover:text-foreground"
      >
        {expanded ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <>
            <ListChecks className="h-4 w-4 text-primary" />
            <span className="typo-caption rotate-180 [writing-mode:vertical-rl]">
              {done}/{total}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
