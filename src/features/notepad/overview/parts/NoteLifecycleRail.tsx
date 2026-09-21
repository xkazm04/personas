// The card's lifecycle rail — the note's steps (`noteLifecycleFor`) as a compact
// row, revealed on hover / keyboard focus, with the NEXT legal step as a button.
//
// It moves the note only through doors that already exist, with the same
// preconditions they already state:
//   - brainstorm `draft → published`  = `publishFleet` (needs a project)
//   - linked     `draft → scoped`     = `toGoals` (promote, then decompose — the
//                                       dispatch bar's own forward verb for a
//                                       linked draft)
//   - plan       `scoped → cut`, `cut → shipped` = the CERTIFY dialog, which lives
//                in the editor's plan provider. The rail opens the note there
//                with the dialog requested; the provider still refuses Ship
//                unless the criteria verdict is `go` (the bar's `shipBlocked`),
//                so the overview never becomes a way round the gate.
// `published → in_progress → completed` are the sweeper's moves, not the
// operator's, so they are shown and never offered.
import { Fragment } from 'react';
import { motion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { noteLifecycleFor, noteStatusMeta } from '../../noteStatusMeta';

export type RailAction = 'publish' | 'goals' | 'certify';

export interface RailNext {
  status: NoteStatus;
  action: RailAction;
  /** A `t.notepad.*` key naming why the move is refused, or null when it is open. */
  blockedKey: 'dispatch_needs_project' | null;
}

/** The one step the rail offers from here, or null. Pure — exported for tests. */
export function railNextStep(note: Pick<DevNote, 'status' | 'milestoneId' | 'projectId'>): RailNext | null {
  const needsProject = note.projectId ? null : 'dispatch_needs_project';
  switch (note.status) {
    case 'draft':
      return note.milestoneId
        ? { status: 'scoped', action: 'goals', blockedKey: needsProject }
        : { status: 'published', action: 'publish', blockedKey: needsProject };
    case 'scoped':
      return { status: 'cut', action: 'certify', blockedKey: null };
    case 'cut':
      return { status: 'shipped', action: 'certify', blockedKey: null };
    default:
      return null;
  }
}

export function NoteLifecycleRail({
  note,
  shown,
  onAdvance,
}: {
  note: DevNote;
  /** Hover / focus-within the rail. The rail stays mounted (and focusable) while hidden. */
  shown: boolean;
  onAdvance: (next: RailNext) => Promise<void>;
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const steps = noteLifecycleFor(note.milestoneId);
  const current = steps.indexOf(note.status);
  const next = railNextStep(note);

  return (
    <motion.div
      role="group"
      aria-label={t.notepad.rail_label}
      data-testid={`notepad-card-rail-${note.id}`}
      data-shown={shown}
      initial={false}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: reduced ? 0 : 4 }}
      transition={reduced ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
      className={`absolute inset-0 flex items-center gap-1 ${shown ? '' : 'pointer-events-none'}`}
    >
      {steps.map((status, i) => {
        const meta = noteStatusMeta(status);
        const label = meta.labelKey(t);
        const isCurrent = i === current;
        const done = current >= 0 && i < current;
        const isNext = next?.status === status;
        const dot = (
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center border transition-colors ${
              isCurrent
                ? `${meta.tone.fill} border-transparent text-background`
                : done
                  ? `${meta.tone.border} ${meta.tone.text}`
                  : 'border-primary/15 text-foreground/85'
            }`}
          >
            <meta.Icon className="w-3 h-3" aria-hidden />
          </span>
        );
        let node;
        if (isNext && next) {
          const moveLabel = tx(t.notepad.rail_move_to, { status: label });
          const blocked = next.blockedKey !== null;
          const button = (
            <AsyncButton
              variant="ghost"
              size="icon-sm"
              aria-label={moveLabel}
              disabled={blocked}
              onClick={() => onAdvance(next)}
              data-testid={`notepad-card-rail-next-${note.id}`}
              className="ring-1 ring-primary/40 rounded-full"
            >
              {dot}
            </AsyncButton>
          );
          node = blocked ? (
            <Tooltip content={t.notepad[next.blockedKey!]} triggerFocusable triggerClassName="inline-flex">
              <span className="pointer-events-none inline-flex">{button}</span>
            </Tooltip>
          ) : (
            <Tooltip content={moveLabel}>{button}</Tooltip>
          );
        } else {
          node = (
            <Tooltip content={isCurrent ? tx(t.notepad.rail_current, { status: label }) : `${label} · ${t.notepad.rail_step_unreachable}`}>
              <span
                role="img"
                aria-label={isCurrent ? tx(t.notepad.rail_current, { status: label }) : label}
                aria-current={isCurrent ? 'step' : undefined}
                data-testid={isCurrent ? `notepad-card-rail-current-${note.id}` : undefined}
                className="inline-flex"
              >
                {dot}
              </span>
            </Tooltip>
          );
        }
        return (
          <Fragment key={status}>
            {i > 0 && <span aria-hidden className={`h-px w-2.5 shrink-0 ${done || isCurrent ? meta.tone.fill : 'bg-primary/15'}`} />}
            {node}
          </Fragment>
        );
      })}
    </motion.div>
  );
}
