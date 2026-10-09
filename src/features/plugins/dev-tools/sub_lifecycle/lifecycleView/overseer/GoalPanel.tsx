/**
 * The Overseer's goal on Layer 1, between the status band and the rail: the
 * goal as HIS WORK.
 *
 * Layer one is ONE line, a strip one control tall (`lcSurface('strip')`), so
 * the rail under it still fits a 1280x800 screen: his mark, the goal's name,
 * the items he still owes as chips (`OpenItemChips`, each opens its item in
 * place), the goal drawn (green of the measurable steps, `GoalMeter`), what is
 * closed and set aside, and the fold. Nothing he owes is ever folded away.
 *
 * The fold opens the detail with motion: every item under the goal as a kit
 * row (`GoalItemRow`) - the open ones first, each set in step order - with the
 * step it is about, what last happened ("Closed by Measure 3 h ago") and its
 * status. It starts folded; the reader's own fold is remembered per project
 * for the session, so coming back from a step screen keeps it. No goal, no
 * strip.
 */
import { useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Meta, Rows } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { useLifecycleViewModel } from '../context';
import type { HealthStep } from '../layer1/healthModel';
import { GoalMeter } from '../layer1/status/GoalMeter';
import { lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { GoalItemRow } from './GoalItemRow';
import { goalTally, isOpenItem, orderedItems } from './goalModel';
import { OpenItemChips } from './OpenItemChips';
import { OverseerMark } from './OverseerMark';

/** The reader's fold per project, this session (module memory, bounded). */
const folds = new Map<string, boolean>();
const FOLDS_CAP = 64;

/** Test-only: forget the folds. */
export function __resetGoalFoldsForTests(): void {
  folds.clear();
}

/** Rows shown before the list offers "Show all". */
const ROW_CAP = 6;

export function GoalPanel({ steps }: { steps: HealthStep[] }) {
  const { snapshot, dl, tx, projectId, order } = useLifecycleViewModel();
  const reduced = useReducedMotion();
  const bodyId = useId();
  const headingId = useId();
  // Re-render on a fold; the fold itself lives in `folds`.
  const [, setTick] = useState(0);
  const goal = snapshot?.goal ?? null;
  if (!goal) return null;

  const open = (projectId ? folds.get(projectId) : undefined) ?? false;
  const toggle = () => {
    if (!projectId) return;
    if (folds.size >= FOLDS_CAP) folds.clear();
    folds.set(projectId, !open);
    setTick((n) => n + 1);
  };
  const items = orderedItems(goal.items, order.map((n) => n.id));
  const owed = items.filter(isOpenItem);
  const tally = goalTally(goal.items);
  // The chips already show what is open; the words count the rest (and the open ones when there are no chips).
  const counts = [
    owed.length === 0 && tally.open > 0 && tx(dl.lcx9_goal_open_n, { count: tally.open }),
    tally.closed > 0 && tx(dl.lcx9_goal_closed_n, { count: tally.closed }),
    tally.decided > 0 && tx(dl.lcx9_goal_decided_n, { count: tally.decided }),
  ];

  return (
    <section
      aria-labelledby={headingId}
      className={`@container/goal ${lcSurface('strip')}`}
      data-testid="lc9-goal-panel"
      data-open={open ? 'true' : 'false'}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <h2 id={headingId} className="flex shrink-0 items-center gap-2">
          <OverseerMark size="sm" />
          <span className="sr-only">{dl.lcx9_goal_eyebrow}: </span>
          <span className={LT.title}>{dl.lcx9_goal_name}</span>
        </h2>
        <OpenItemChips items={owed} />
        <span className="ml-auto flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
          <GoalMeter steps={steps} />
          {counts.some(Boolean) && (
            <span className={`flex items-center gap-1.5 ${LT.meta}`} data-testid="lc9-goal-tally"><Meta parts={counts} /></span>
          )}
          <Button
            variant="ghost"
            size="xs"
            iconRight={<ChevronDown className={`${GLYPH.sm} transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />}
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            data-testid="lc9-goal-toggle"
          >
            {open ? dl.lcx9_goal_hide : tx(dl.lcx9_goal_show, { count: items.length })}
          </Button>
        </span>
      </div>
      <div id={bodyId}>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="items"
              className="overflow-hidden"
              initial={reduced ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              data-testid="lc9-goal-items"
            >
              <div className="pb-1.5 pt-2.5">
                <Rows count={items.length} cap={ROW_CAP} empty={{ title: dl.lcx9_goal_no_items }}>
                  {items.map((item) => <GoalItemRow key={item.id} item={item} />)}
                </Rows>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
