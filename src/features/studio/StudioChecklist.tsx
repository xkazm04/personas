import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronRight, ListChecks, Plus } from 'lucide-react';
import { MOCK_PHASES, phaseProgress, type BuildPhase } from './studioBuildModel';
import StudioChecklistStepper from './StudioChecklistStepper';

// Right-docked build-checklist: an always-visible edge tab. On a plan change we
// flash ONLY the changed item in a quick-view pill (fade in from the left, hold,
// fade back) instead of auto-opening the whole panel. The full plan is one click
// away and stands up to 70% of the app height (long plans scroll inside that).

const QUICK_VIEW_MS = 3200;

type Change = { phase: BuildPhase; kind: 'done' | 'active' | 'new' };

// The single most-relevant change between two plans, for the quick view:
// a phase that just completed > one that just became active > a brand-new phase.
function changedPhase(prev: BuildPhase[], next: BuildPhase[]): Change | null {
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const justDone = next.find((p) => p.status === 'done' && prevById.get(p.id)?.status !== 'done');
  if (justDone) return { phase: justDone, kind: 'done' };
  const justActive = next.find(
    (p) => p.status === 'active' && prevById.get(p.id)?.status !== 'active',
  );
  if (justActive) return { phase: justActive, kind: 'active' };
  const fresh = next.find((p) => !prevById.has(p.id));
  if (fresh) return { phase: fresh, kind: 'new' };
  return null;
}

export default function StudioChecklist({ phases = MOCK_PHASES }: { phases?: BuildPhase[] }) {
  const [expanded, setExpanded] = useState(false);
  const [quick, setQuick] = useState<Change | null>(null);
  const quickTimer = useRef<number | null>(null);
  const prevPhases = useRef<BuildPhase[]>(phases);
  const { done, total } = phaseProgress(phases);

  // Detect a plan change → flash the changed item in the quick view (unless the
  // full panel is already open, where the change shows in place).
  useEffect(() => {
    const change = changedPhase(prevPhases.current, phases);
    prevPhases.current = phases;
    if (change && !expanded) {
      setQuick(change);
      if (quickTimer.current) window.clearTimeout(quickTimer.current);
      quickTimer.current = window.setTimeout(() => setQuick(null), QUICK_VIEW_MS);
    }
  }, [phases, expanded]);

  useEffect(
    () => () => {
      if (quickTimer.current) window.clearTimeout(quickTimer.current);
    },
    [],
  );

  const toggle = () => {
    setQuick(null);
    setExpanded((e) => !e);
  };

  return (
    <div className="absolute right-0 top-3 z-20 flex items-start gap-1.5">
      <AnimatePresence mode="wait">
        {expanded ? (
          <motion.aside
            key="panel"
            initial={{ x: 16, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="flex max-h-[70vh] w-64 flex-col overflow-hidden rounded-card border border-border bg-background/95 shadow-elevation-4 backdrop-blur"
          >
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <ListChecks className="h-4 w-4 shrink-0 text-primary" />
              <span className="typo-caption flex-1 text-foreground">
                Build plan · {done}/{total}
              </span>
            </header>
            {/* Fills the panel up to 70vh; long plans scroll here. */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <StudioChecklistStepper phases={phases} />
            </div>
          </motion.aside>
        ) : quick ? (
          <motion.div
            key={`quick-${quick.phase.id}-${quick.kind}`}
            data-testid="studio-checklist-quickview"
            initial={{ x: -14, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -14, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 460, damping: 32 }}
            className="flex max-w-[16rem] items-center gap-2 rounded-card border border-border bg-background/95 px-3 py-2 shadow-elevation-4 backdrop-blur"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                quick.kind === 'done'
                  ? 'bg-primary text-background'
                  : quick.kind === 'active'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-secondary text-primary'
              }`}
            >
              {quick.kind === 'done' ? (
                <Check className="h-2.5 w-2.5" />
              ) : quick.kind === 'new' ? (
                <Plus className="h-2.5 w-2.5" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-md text-foreground">
              {quick.phase.title}
            </span>
            <span className="typo-caption shrink-0 text-foreground/60">
              {done}/{total}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={toggle}
        data-testid="studio-checklist-tab"
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
