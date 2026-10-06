import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ListChecks, Plus, X } from 'lucide-react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { guideStrings } from './guideCopy';
import { PlanGlyph } from '../PlanGlyph';
import StudioChecklistStepper from '../StudioChecklistStepper';
import type { BuildPhase } from '../studioBuildModel';

export interface GuideGoalsRailHandle {
  /** Open the "add a goal" field and focus it (the G key). */
  startAdding: () => void;
}

// The left timeline of goals: the real BUILD_PLAN phases, drawn in the build
// plan drawer's style (the Classic layout's, kept when Classic was removed
// 2026-10-06): an icon header with the count, a thin progress line, the
// stepper timeline. "Add a goal" sends a turn asking Athena to slot the new
// goal into the plan herself. The dock's goals button shows or hides it.
const GuideGoalsRail = forwardRef<
  GuideGoalsRailHandle,
  {
    open: boolean;
    onClose: () => void;
    phases: BuildPhase[];
    placeholder: boolean;
    /** A planning step is running: the goals are genuinely on their way. */
    drafting: boolean;
    /** Athena is working a step right now. */
    busy: boolean;
    /** The sketch lane's draft goals, shown until the real plan lands. */
    draftGoals?: { title: string; note: string }[];
    canAdd: boolean;
    /** False when the goal could not be taken (a full note queue). */
    onAddGoal: (goal: string) => boolean | void;
  }
>(function GuideGoalsRail({ open, onClose, phases, placeholder, drafting, busy, draftGoals, canAdd, onAddGoal }, ref) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const { shouldAnimate } = useMotion();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    startAdding: () => {
      if (canAdd) setAdding(true);
    },
  }));
  // The field mounts with the rail, which may be opening in the same keypress.
  useEffect(() => {
    if (adding && open) inputRef.current?.focus();
  }, [adding, open]);

  const done = phases.filter((p) => p.status === 'done').length;
  const total = phases.length;
  const hasPlan = !placeholder && total > 0;
  const pct = hasPlan ? Math.round((done / total) * 100) : 0;
  const submit = () => {
    const goal = draft.trim();
    if (!goal) return;
    // A full note queue refuses the goal: keep it in the box.
    if (onAddGoal(goal) === false) return;
    setDraft('');
    setAdding(false);
  };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          key="studio-goals-rail"
          data-testid="studio-goals-rail"
          aria-label={g.goals}
          initial={shouldAnimate ? { width: 0, opacity: 0 } : { opacity: 0 }}
          animate={{ width: '15rem', opacity: 1 }}
          exit={shouldAnimate ? { width: 0, opacity: 0 } : { opacity: 0 }}
          transition={shouldAnimate ? { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 } : { duration: 0.15 }}
          className="flex shrink-0 flex-col overflow-hidden border-r border-border bg-background"
        >
          {/* Fixed inner width: the rail's width animates, its content never reflows. */}
          <div className="flex h-full w-60 flex-col">
            <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <ListChecks className="h-4 w-4 text-primary" />
                {busy && <span className="absolute inline-flex h-4 w-4 animate-ping rounded-full bg-primary/25" />}
              </span>
              <h2 className="typo-heading text-foreground">{g.goals}</h2>
              {hasPlan && (
                <span className="font-mono typo-caption tabular-nums" aria-label={tx(g.goals_progress, { done, total })}>
                  {done}/{total}
                </span>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={onClose}
                aria-label={g.goals_hide}
                className="flex h-7 w-7 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {hasPlan && (
              <div className="h-0.5 shrink-0 bg-secondary/50">
                <motion.div
                  className="h-full w-full origin-left bg-primary"
                  initial={false}
                  animate={{ scaleX: pct / 100 }}
                  transition={{ duration: shouldAnimate ? 0.5 : 0, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              {placeholder && draftGoals && draftGoals.length > 0 ? (
                <>
                  <p className="mb-3 typo-caption">{g.goals_draft_hint}</p>
                  <StudioChecklistStepper
                    draft
                    stagger
                    phases={draftGoals.map((d, i) => ({ id: `draft-${i}`, title: d.title, note: d.note || null, status: 'pending' }))}
                  />
                </>
              ) : placeholder && drafting ? (
                <>
                  <p className="typo-caption">{g.goals_drafting}</p>
                  {/* Ghost rows only while goals are really on their way; an idle
                      project with no plan says so instead of loading forever. */}
                  <ul className="mt-4 space-y-4" aria-hidden>
                    {[70, 82, 60, 76].map((w) => (
                      <li key={w} className="flex items-center gap-3">
                        <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
                        <span className="h-2.5 rounded-full bg-secondary/60" style={{ width: `${w}%` }} />
                      </li>
                    ))}
                  </ul>
                </>
              ) : placeholder ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                  <PlanGlyph size={88} />
                  <p className="typo-caption">{g.goals_none}</p>
                </div>
              ) : (
                <StudioChecklistStepper
                  stagger
                  focusable
                  phases={phases}
                  caption={(p) => (p.status === 'active' ? g.goal_now : p.status === 'done' ? p.note || g.goal_done : p.note)}
                />
              )}
            </div>

            <div className="shrink-0 border-t border-border p-3">
              {adding ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setAdding(false);
                    }
                  }}
                  onBlur={() => !draft.trim() && setAdding(false)}
                  placeholder={g.add_goal_placeholder}
                  aria-label={g.add_goal}
                  className="w-full rounded-input border border-primary/50 bg-background/60 px-3 py-2 typo-body text-foreground outline-none placeholder:text-foreground/90"
                />
              ) : (
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center justify-between rounded-interactive border border-dashed border-border px-3 py-2 typo-body text-foreground/90 transition-colors hover:border-primary/60 hover:text-foreground disabled:is-disabled"
                >
                  <span className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    {g.add_goal}
                  </span>
                  <kbd className="rounded-interactive border border-border px-1.5 font-mono text-xs text-foreground/90">G</kbd>
                </button>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
});

export default GuideGoalsRail;
