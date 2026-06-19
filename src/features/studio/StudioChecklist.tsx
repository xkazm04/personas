import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ListChecks } from 'lucide-react';
import { MOCK_PHASES, phaseProgress, type BuildPhase } from './studioBuildModel';
import StudioChecklistStepper from './StudioChecklistStepper';
import StudioChecklistCards from './StudioChecklistCards';
import StudioChecklistMinimal from './StudioChecklistMinimal';

// Right-docked build-checklist DRAWER: a thin always-visible edge tab that
// expands into a panel. Auto-expands when progress is made and auto-hides after
// 10s of no interaction; both transitions are animated. The panel's visual
// design is being /prototype'd via the variant switcher (Stepper / Cards /
// Minimal). Phases are mocked until the build_plan op (P3) feeds real ones.

type Variant = 'stepper' | 'cards' | 'minimal';
const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'stepper', label: 'Stepper' },
  { id: 'cards', label: 'Cards' },
  { id: 'minimal', label: 'Minimal' },
];

const AUTO_HIDE_MS = 10_000;

export default function StudioChecklist({ phases = MOCK_PHASES }: { phases?: BuildPhase[] }) {
  const [expanded, setExpanded] = useState(false);
  const [variant, setVariant] = useState<Variant>('stepper');
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
    <div className="absolute right-0 top-0 bottom-0 z-20 flex items-start">
      {/* always-visible edge tab */}
      <button
        type="button"
        onClick={toggle}
        aria-label="Build checklist"
        aria-expanded={expanded}
        className="mt-3 flex w-8 flex-col items-center gap-1.5 rounded-l-card border border-r-0 border-border bg-background/90 py-2.5 text-foreground/70 shadow-elevation-2 backdrop-blur transition-colors hover:text-foreground"
      >
        <ListChecks className="h-4 w-4 text-primary" />
        <span className="typo-caption rotate-180 [writing-mode:vertical-rl]">
          {done}/{total}
        </span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.aside
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            className="flex h-full w-72 flex-col overflow-hidden border-l border-border bg-background/95 shadow-elevation-4 backdrop-blur"
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <span className="typo-caption flex-1 text-foreground">
                Build plan · {done}/{total}
              </span>
              {/* prototype variant switcher (throwaway) */}
              <div className="flex gap-0.5">
                {VARIANTS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVariant(v.id)}
                    className={`rounded-full px-2 py-0.5 text-xs transition-colors ${variant === v.id ? 'bg-primary/20 text-primary' : 'text-foreground/50 hover:text-foreground'}`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label="Hide checklist"
                className="rounded-interactive p-1 text-foreground/60 hover:bg-secondary/60 hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-3">
              {variant === 'stepper' && <StudioChecklistStepper phases={phases} />}
              {variant === 'cards' && <StudioChecklistCards phases={phases} />}
              {variant === 'minimal' && <StudioChecklistMinimal phases={phases} />}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
