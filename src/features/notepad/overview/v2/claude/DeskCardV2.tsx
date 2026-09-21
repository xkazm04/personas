// One note on the v2 desk.
//
// The same anatomy as the baseline `NoteDeskCard` — project + state row, title,
// goals rule, quick-write (or result), presence line, footer with the lifecycle
// rail — composed from the SAME parts, so every live behaviour is the
// baseline's own. What changes is ownership: the thread popover, the bubble and
// the menu are lifted to the desk, so the keyboard can open, answer and settle
// them on whichever card the cursor is on.
//
// Visual changes: the card lifts under the cursor and shows its lifecycle rail
// while selected (the keyboard user sees the next step without hovering); a
// Find query highlights the matched letters of the title.
import { useCallback, useEffect, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';

import type { NotePatch, NoteSaveState } from '../../../notepadStore';
import { noteStatusMeta } from '../../../noteStatusMeta';
import { resultSummary } from '../../../noteText';
import { registerVisibleCard } from '../../../thread/cardVisibility';
import { NoteThreadButton } from '../../../thread/NoteThreadButton';
import type { NoteWorking } from '../../../thread/useNoteWorking';
import type { DeskForecast } from '../../deskForecast';
import { NoteCardBubble } from '../../parts/NoteCardBubble';
import { GoalsBar, NoteCardFooter, NoteStatusGlyph, PlanStampBadge } from '../../parts/NoteCardBits';
import { NoteLifecycleRail, type RailNext } from '../../parts/NoteLifecycleRail';
import { NotePresenceChip, WorkingEdge } from '../../parts/NotePresenceChip';
import { NoteProjectPicker } from '../../parts/NoteProjectPicker';
import { NoteQuickWrite } from '../../parts/NoteQuickWrite';
import { splitHighlights } from './deskKeyModel';

const IDLE: NoteWorking = { kind: null, since: null, label: null, elapsedTemplate: null };

/** Right-clicks inside something editable keep the platform's own menu. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export interface DeskCardV2Props {
  note: DevNote;
  projects: readonly DevProject[];
  saveState: NoteSaveState;
  summary?: NotePlanSummary;
  forecast?: DeskForecast;
  working?: NoteWorking;
  order: number;
  reveal: { hasEntered: (id: string) => boolean; markEntered: (id: string) => void };
  autoFocus: boolean;
  selected: boolean;
  /** Title ranges to highlight (Find mode). */
  titleRanges: ReadonlyArray<readonly [number, number]>;
  threadOpen: boolean;
  onThreadOpenChange: (open: boolean) => void;
  bubble: NoteComment | null;
  /** Stable (from `useDeskBubbles`) — the bubble's clock effect depends on it. */
  dismissBubble: (noteId: string) => void;
  onOpen: () => void;
  onPatch: (patch: NotePatch) => void;
  onAdvance: (next: RailNext) => Promise<void>;
  /** Pointer or focus landed on the card: it takes the cursor. */
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  /** The composer, docked under the card while it is open for this note. */
  composer?: ReactNode;
}

export function DeskCardV2({
  note,
  projects,
  saveState,
  summary,
  forecast,
  working = IDLE,
  order,
  reveal,
  autoFocus,
  selected,
  titleRanges,
  threadOpen,
  onThreadOpenChange,
  bubble,
  dismissBubble,
  onOpen,
  onPatch,
  onAdvance,
  onSelect,
  onMenu,
  composer,
}: DeskCardV2Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const meta = noteStatusMeta(note.status);
  const summaryStamped = Boolean(summary && (summary.cutAt || summary.shippedAt));
  const result = note.status === 'completed' ? resultSummary(note.resultJson) : null;

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [railFocused, setRailFocused] = useState(false);

  // Mounted = visible: this card's entries bubble here, not in the stack. On
  // the way out its bubble goes too — a card filtered away and brought back
  // must not replay a stale bubble with a fresh 10 s clock.
  const onDismissBubble = useCallback(() => dismissBubble(note.id), [dismissBubble, note.id]);
  useEffect(() => {
    const release = registerVisibleCard(note.id);
    return () => {
      release();
      dismissBubble(note.id);
    };
  }, [note.id, dismissBubble]);

  // The thread on screen swallows the bubble: the popover shows the same entry.
  useEffect(() => {
    if (threadOpen && bubble) onDismissBubble();
  }, [threadOpen, bubble, onDismissBubble]);

  const onContextMenu = (e: MouseEvent) => {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    onSelect();
    onMenu(e.clientX, e.clientY);
  };

  const trackEditing = (e: FocusEvent, on: boolean) => {
    if (isEditableTarget(e.target)) setEditing(on);
  };

  const railShown = (hovered && !editing) || railFocused || (selected && !editing);
  const glyphKey = summary && summaryStamped ? `stamp-${summary.shippedAt ? 'shipped' : 'cut'}` : note.status;
  const workingRing = working.kind === 'athena' ? 'ring-1 ring-brand-purple/35' : working.kind === 'fleet' ? 'ring-1 ring-status-info/35' : '';
  const spring = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 420, damping: 30 };

  return (
    <motion.div
      className="relative h-full flex flex-col"
      animate={{ y: selected && !reduced ? -3 : 0 }}
      transition={spring}
    >
      <RevealItem
        revealId={note.id}
        order={order}
        {...reveal}
        data-testid={`notepad-card-${note.id}`}
        data-status={note.status}
        data-selected={selected}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseDown={onSelect}
        onFocusCapture={(e) => {
          trackEditing(e, true);
          onSelect();
        }}
        onBlurCapture={(e) => trackEditing(e, false)}
        onContextMenu={onContextMenu}
        className={`group relative overflow-hidden flex-1 min-h-52 flex flex-col gap-2 px-4 pt-4 pb-2.5 rounded-card border ${meta.tone.border} ${meta.tone.wash} ${workingRing} ${
          selected ? 'shadow-elevation-3' : 'hover:shadow-elevation-2'
        } transition-[box-shadow,border-color,background-color] duration-300`}
      >
        <span className={`absolute inset-x-0 top-0 h-0.5 ${meta.tone.fill} transition-colors duration-300`} aria-hidden />
        <AnimatePresence>{working.kind && <WorkingEdge key={working.kind} working={working} />}</AnimatePresence>

        <div className="flex items-center justify-between gap-2">
          <NoteProjectPicker note={note} projects={projects} onSelect={(projectId) => onPatch({ projectId })} />
          <div className="flex items-center gap-1 shrink-0">
            <NoteThreadButton
              noteId={note.id}
              noteTitle={note.title}
              open={threadOpen}
              onOpenChange={onThreadOpenChange}
              quietWhenRead={!selected}
              testId={`notepad-card-thread-${note.id}`}
            />
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={glyphKey}
                className="inline-flex"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -20 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: 20 }}
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 24 }}
              >
                {summary && summaryStamped ? (
                  <PlanStampBadge note={note} summary={summary} />
                ) : (
                  <NoteStatusGlyph status={note.status} label={meta.labelKey(t)} testId={`notepad-card-status-${note.id}`} />
                )}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>

        <button type="button" onClick={onOpen} className="text-left rounded-input focus-ring">
          <span className="block typo-title-lg text-foreground line-clamp-2" data-testid={`notepad-v2c-title-${note.id}`}>
            {titleRanges.length === 0
              ? note.title
              : splitHighlights(note.title, titleRanges).map((run, i) =>
                  run.hit ? (
                    <mark key={i} className="bg-status-info/25 text-foreground rounded-interactive">
                      {run.text}
                    </mark>
                  ) : (
                    <span key={i}>{run.text}</span>
                  ),
                )}
          </span>
        </button>

        {summary && <GoalsBar note={note} summary={summary} />}

        {result ? (
          <button type="button" onClick={onOpen} className="flex-1 min-h-0 text-left rounded-input focus-ring">
            <span className={`block typo-label mb-1 ${meta.tone.text}`}>{t.notepad.result_title}</span>
            <span className="typo-body text-foreground/85 line-clamp-4">{result}</span>
          </button>
        ) : (
          <NoteQuickWrite note={note} onPatch={onPatch} onOpen={onOpen} autoFocus={autoFocus} />
        )}

        <AnimatePresence initial={false}>
          {working.kind && (
            <motion.div
              key="presence"
              initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
              transition={reduced ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
              className="flex"
            >
              <NotePresenceChip noteId={note.id} working={working} />
            </motion.div>
          )}
        </AnimatePresence>

        <NoteCardFooter
          note={note}
          saveState={saveState}
          forecast={forecast}
          onOpen={onOpen}
          railShown={railShown}
          onRailFocusChange={setRailFocused}
          rail={<NoteLifecycleRail note={note} shown={railShown} onAdvance={onAdvance} />}
        />
      </RevealItem>

      <AnimatePresence>
        {bubble && !threadOpen && (
          <NoteCardBubble
            key={bubble.id}
            entry={bubble}
            onDismiss={onDismissBubble}
            onRead={() => {
              onDismissBubble();
              onThreadOpenChange(true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{composer}</AnimatePresence>
    </motion.div>
  );
}
