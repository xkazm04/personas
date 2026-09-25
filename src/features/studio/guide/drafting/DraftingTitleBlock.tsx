import type { ReactNode, Ref } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { LETTERING } from './draftingModel';

/** Who drew the sheet: a name, not copy. */
const DRAFTER = 'Athena';

export interface TitleGoal {
  title: string;
  note?: string | null;
  state: 'pending' | 'active' | 'done';
}

// The drawing's title block (contest A/3), in the bottom-right corner where a
// drafter puts it: the project, where it stands, the brief, the goals as the
// plan (numbered, inked as they get done), Athena's notes, and a stamp when
// the plan waits for approval or is done.
export default function DraftingTitleBlock({
  labels,
  project,
  status,
  brief,
  goals,
  goalsEmpty,
  stateWords,
  notes,
  stamp,
  activeGoalRef,
  notesRef,
}: {
  labels: { project: string; status: string; brief: string; goals: string; notes: string; drawn: string };
  project: string;
  status: string;
  brief: string | null;
  goals: TitleGoal[];
  goalsEmpty: string;
  stateWords: Record<TitleGoal['state'], string>;
  notes: ReactNode;
  stamp: string | null;
  /** Receives the goal row in work, for the pen. */
  activeGoalRef?: Ref<HTMLLIElement>;
  /** Receives the notes cell, where the pen waits during setup. */
  notesRef?: Ref<HTMLDivElement>;
}) {
  const { shouldAnimate } = useMotion();
  return (
    <div
      className="relative grid min-h-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)]"
      style={{ border: '1px solid var(--ink)', background: 'color-mix(in srgb, var(--paper) 92%, transparent)' }}
    >
      <Cell label={labels.project}>
        <p className="truncate typo-title-lg uppercase" style={{ color: 'var(--ink-strong)' }}>
          {project}
        </p>
      </Cell>
      <Cell label={labels.status}>
        <p className="truncate typo-body text-foreground">{status}</p>
        <p className="truncate typo-caption">
          {labels.drawn} {DRAFTER}
        </p>
      </Cell>
      <Cell label={labels.brief} span dashed={!brief}>
        <p className="line-clamp-2 typo-body text-foreground">{brief ?? ''}</p>
      </Cell>
      <Cell label={labels.goals} dashed={goals.length === 0}>
        {goals.length === 0 ? (
          <p className="typo-caption">{goalsEmpty}</p>
        ) : (
          <ol className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
            {goals.map((g, i) => (
              <motion.li
                key={`${i}-${g.title}`}
                ref={g.state === 'active' ? activeGoalRef : undefined}
                initial={shouldAnimate ? { opacity: 0, x: -6 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.06 * i, duration: 0.3 }}
                className="flex items-center gap-2"
              >
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    ...LETTERING,
                    letterSpacing: 0,
                    border: '1px solid var(--ink)',
                    background: g.state === 'pending' ? 'transparent' : 'var(--ink)',
                    color: g.state === 'pending' ? 'var(--ink-strong)' : 'var(--paper)',
                  }}
                >
                  {i + 1}
                </span>
                <span className={`min-w-0 flex-1 truncate typo-body ${g.state === 'pending' ? 'text-foreground/90' : 'text-foreground'}`}>
                  {g.title}
                </span>
                {g.state !== 'pending' && (
                  <span
                    className={`shrink-0 typo-caption ${g.state === 'done' ? 'text-status-success' : ''}`}
                    style={g.state === 'active' ? { color: 'var(--ink-strong)' } : undefined}
                  >
                    {stateWords[g.state]}
                  </span>
                )}
              </motion.li>
            ))}
          </ol>
        )}
      </Cell>
      <Cell label={labels.notes}>
        <div ref={notesRef} className="line-clamp-4 typo-body text-foreground">
          {notes}
        </div>
      </Cell>
      {/* Always mounted, so a stamp that lands is announced (a region born
          with its text is not). The stamp itself is decoration. */}
      <span className="sr-only" aria-live="polite">
        {stamp ?? ''}
      </span>
      <AnimatePresence>
        {stamp && (
          <motion.span
            key={stamp}
            aria-hidden
            initial={shouldAnimate ? { opacity: 0, scale: 2.4, rotate: -8 } : { opacity: 0.92, rotate: -8 }}
            animate={{ opacity: 0.92, scale: 1, rotate: -8 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 16 }}
            className="absolute bottom-2 right-3 rounded-interactive px-2.5 py-1"
            style={{ ...LETTERING, fontSize: 15, letterSpacing: '0.18em', color: 'var(--ink-strong)', border: '2.5px solid var(--ink-strong)' }}
          >
            {stamp}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Cell({ label, children, span = false, dashed = false }: { label: string; children: ReactNode; span?: boolean; dashed?: boolean }) {
  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden px-3 py-2 ${span ? 'col-span-2' : ''}`}
      style={{ border: `1px ${dashed ? 'dashed' : 'solid'} var(--ink-faint)` }}
    >
      <span style={{ ...LETTERING, color: 'var(--ink)' }}>{label}</span>
      {children}
    </div>
  );
}
