import { useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';

import { archiveNote, type NotePatch, type NoteSaveState } from '../notepadStore';
import { noteStatusMeta } from '../noteStatusMeta';
import { publishFleet, toGoals, type NoteDispatchResult } from '../notepadActions';
import { noteAskBlockedReasonKey, noteDeleteBlocked } from '../noteGuards';
import { resultSummary } from '../noteText';
import { registerVisibleCard } from '../thread/cardVisibility';
import { NoteThreadButton } from '../thread/NoteThreadButton';
import { approveReview, rejectReview } from '../thread/threadActions';
import { isPendingReview } from '../thread/threadLabels';
import type { NoteWorking } from '../thread/useNoteWorking';
import type { DeskForecast } from './deskForecast';
import { NoteCardBubble, useCardBubble } from './parts/NoteCardBubble';
import { GoalsBar, NoteCardFooter, NoteStatusGlyph, PlanStampBadge } from './parts/NoteCardBits';
import { NoteAskQuickInput, NoteCardMenu } from './parts/NoteCardMenu';
import { NoteLifecycleRail, type RailNext } from './parts/NoteLifecycleRail';
import { NotePresenceChip, WorkingEdge } from './parts/NotePresenceChip';
import { NoteProjectPicker } from './parts/NoteProjectPicker';
import { NoteQuickWrite } from './parts/NoteQuickWrite';
import { reviewKeyEffect, splitHighlight, type CardAction } from './deskModel';
import type { BubbleIntent } from './parts/NoteCardBubble';

/** One keyboard verb aimed at this card. `seq` makes a repeated key a new command. */
export interface CardCommand {
  seq: number;
  kind: CardAction;
}

interface NoteDeskCardProps {
  note: DevNote;
  projects: readonly DevProject[];
  saveState: NoteSaveState;
  /** The linked milestone's reading, or `undefined` for a brainstorm note —
   *  and also for a linked one while the join is unreachable. Absence is the
   *  honest answer for both; the card renders no plan chrome either way. */
  summary?: NotePlanSummary;
  /** Absent unless the note is linked, unshipped, and its project has enough
   *  observed cycles to forecast from (`deskForecast.ts`). */
  forecast?: DeskForecast;
  /** Who is working on the note, from the grid's ONE presence subscription
   *  (`useNotesWorkingMap`). Absent while idle. */
  working?: NoteWorking;
  /** Position in the grid's entrance cascade. */
  order: number;
  reveal: { hasEntered: (id: string) => boolean; markEntered: (id: string) => void };
  autoFocus: boolean;
  /** The desk's lamp is on this card. */
  selected?: boolean;
  /** The active find query — its first token is highlighted in the title. */
  query?: string;
  /** The latest keyboard verb aimed at this card, or null. */
  command?: CardCommand | null;
  /** Pointer-down anywhere on the card moves the lamp here. */
  onSelect?: () => void;
  /** Told whether this card's bubble carries a pending review, while selected —
   *  the hint rail shows `y` / `n` only then. */
  onPendingReview?: (pending: boolean) => void;
  onOpen: () => void;
  onPatch: (patch: NotePatch) => void;
  /** Delete permanently — the host routes it through its ConfirmDialog. */
  onDelete: () => void;
  /** Open the note in the editor with the certify dialog requested (the plan
   *  rail's cut / ship step). */
  onCertify: () => void;
}

const IDLE: NoteWorking = { kind: null, since: null, label: null, elapsedTemplate: null };
const NO_SELECT = () => {};

/** Right-clicks inside something editable keep the platform's own menu. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * One note on the desk. Chrome is held to three thin rows — project + state,
 * title, and a single footer — so the card's height goes to the note itself.
 * State is carried twice: a colour edge along the top and an icon-only badge. A
 * completed note shows what came back from its run in place of its text.
 *
 * A LINKED note adds three readings and no new row: a goals rule under the
 * title, the milestone's stamp folded into the badge it would otherwise
 * duplicate, and one forecast line above the footer.
 *
 * THE LIVE LAYER adds, still without a permanent row: a presence line above the
 * footer and a breathing top edge while Athena or a Fleet agent works on the
 * note; the thread icon with its unread count beside the status glyph (which
 * crossfades when the status moves); the lifecycle rail, which takes the
 * footer's metadata slot on hover or selection; a right-click menu; and the
 * newest unread thread entry as a 10 s bubble.
 *
 * SELECTED, the card lifts, the traveling lamp (`layoutId`) lands on its top
 * edge, and it becomes the target of the desk's keyboard verbs, delivered as
 * `command`. Review keys act on the bubble when one is up — the same place the
 * mouse would — and fall back to the thread (`reviewKeyEffect`).
 */
export function NoteDeskCard({
  note,
  projects,
  saveState,
  summary,
  forecast,
  working = IDLE,
  order,
  reveal,
  autoFocus,
  selected = false,
  query = '',
  command = null,
  onSelect = NO_SELECT,
  onPendingReview,
  onOpen,
  onPatch,
  onDelete,
  onCertify,
}: NoteDeskCardProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const meta = noteStatusMeta(note.status);
  const summaryStamped = Boolean(summary && (summary.cutAt || summary.shippedAt));
  const result = note.status === 'completed' ? resultSummary(note.resultJson) : null;
  const project = projects.find((p) => p.id === note.projectId) ?? null;
  const cardRef = useRef<HTMLDivElement>(null);
  const lastCommand = useRef(0);
  const intentSeq = useRef(0);

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [railFocused, setRailFocused] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [ask, setAsk] = useState<{ x: number; y: number } | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const [bubbleIntent, setBubbleIntent] = useState<BubbleIntent | null>(null);
  const { entry: bubbleEntry, dismiss: dismissBubble } = useCardBubble(note.id);

  // Mounted = visible: this card's entries bubble here, not in the stack.
  useEffect(() => registerVisibleCard(note.id), [note.id]);

  // The thread on screen swallows the bubble: the popover shows the same entry.
  useEffect(() => {
    if (threadOpen) dismissBubble();
  }, [threadOpen, dismissBubble]);

  useEffect(() => {
    if (!selected) return;
    onPendingReview?.(Boolean(bubbleEntry && isPendingReview(bubbleEntry)));
  }, [selected, bubbleEntry, onPendingReview]);

  /** Same refusal sentence the dispatch bar uses for a precondition that
   *  changed under the click; real failures are already toasted. */
  const run = useCallback(
    async (fn: () => Promise<NoteDispatchResult>) => {
      const r = await fn();
      if (!r.ok && r.pending) {
        useToastStore.getState().addToast(note.projectId ? t.notepad.dispatch_needs_draft : t.notepad.dispatch_needs_project, 'warning');
      }
    },
    [note.projectId, t],
  );

  const advance = useCallback(
    async (next: RailNext) => {
      if (next.action === 'publish') return run(() => publishFleet(note, project));
      if (next.action === 'goals') return run(() => toGoals(note, project));
      onCertify();
    },
    [note, project, run, onCertify],
  );

  const openAskAtCard = useCallback(() => {
    const reason = noteAskBlockedReasonKey(note);
    if (reason) {
      useToastStore.getState().addToast(t.notepad[reason], 'warning');
      return;
    }
    const rect = cardRef.current?.getBoundingClientRect();
    setAsk({ x: (rect?.left ?? 24) + 24, y: (rect?.top ?? 24) + 32 });
  }, [note, t]);

  useEffect(() => {
    if (!command || command.seq === lastCommand.current) return;
    lastCommand.current = command.seq;
    switch (command.kind) {
      case 'ask':
        openAskAtCard();
        break;
      case 'thread':
        setThreadOpen(true);
        break;
      case 'reply':
      case 'approve':
      case 'reject': {
        const effect = reviewKeyEffect(command.kind, {
          up: Boolean(bubbleEntry) && !threadOpen,
          pendingReview: Boolean(bubbleEntry && isPendingReview(bubbleEntry)),
          refKind: bubbleEntry?.refKind ?? null,
        });
        if (effect === 'bubbleComment' || effect === 'rejectReason') {
          intentSeq.current += 1;
          setBubbleIntent({ seq: intentSeq.current, kind: effect === 'bubbleComment' ? 'comment' : 'reject' });
        } else if (effect === 'approve' && bubbleEntry) {
          void approveReview(bubbleEntry).then((r) => {
            if (r.ok) dismissBubble();
          });
        } else if (effect === 'rejectNow' && bubbleEntry) {
          void rejectReview(bubbleEntry).then((r) => {
            if (r.ok) dismissBubble();
          });
        } else {
          // `threadReply` and `thread`: the popover's composer auto-focuses.
          setThreadOpen(true);
        }
        break;
      }
      case 'publish':
        void run(() => publishFleet(note, project));
        break;
      case 'goals':
        void run(() => toGoals(note, project));
        break;
      case 'delete':
        if (noteDeleteBlocked(note, useSystemStore.getState().fleetSessions)) {
          useToastStore.getState().addToast(t.notepad.menu_delete_blocked_running, 'warning');
        } else {
          onDelete();
        }
        break;
    }
  }, [command, openAskAtCard, bubbleEntry, threadOpen, dismissBubble, run, note, project, t, onDelete]);

  const onContextMenu = (e: MouseEvent) => {
    if (isEditableTarget(e.target)) return;
    e.preventDefault();
    setAsk(null);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const trackEditing = (e: FocusEvent, on: boolean) => {
    if (isEditableTarget(e.target)) setEditing(on);
  };

  const railShown = selected || (hovered && !editing) || railFocused;
  const glyphKey = summary && summaryStamped ? `stamp-${summary.shippedAt ? 'shipped' : 'cut'}` : note.status;
  const workingRing = working.kind === 'athena' ? 'ring-1 ring-brand-purple/35' : working.kind === 'fleet' ? 'ring-1 ring-status-info/35' : '';
  const titleHit = splitHighlight(note.title, query);

  return (
    <div
      ref={cardRef}
      className="relative h-full flex flex-col"
      data-desk-id={note.id}
      data-selected={selected ? 'true' : 'false'}
      onPointerDown={onSelect}
    >
      <RevealItem
        revealId={note.id}
        order={order}
        {...reveal}
        id={`notepad-desk-card-${note.id}`}
        data-testid={`notepad-card-${note.id}`}
        data-status={note.status}
        aria-current={selected ? 'true' : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={(e) => trackEditing(e, true)}
        onBlurCapture={(e) => trackEditing(e, false)}
        onContextMenu={onContextMenu}
        className={`group relative overflow-hidden flex-1 min-h-52 flex flex-col gap-2 px-4 pt-4 pb-2.5 rounded-card border ${meta.tone.border} ${meta.tone.wash} ${workingRing} ${
          selected ? 'shadow-elevation-3 ring-2 ring-primary/45' : 'hover:shadow-elevation-2'
        } transition-[box-shadow,border-color,background-color] duration-300`}
      >
        <span className={`absolute inset-x-0 top-0 h-0.5 ${meta.tone.fill} transition-colors duration-300`} aria-hidden />
        {selected && (
          <motion.span
            layoutId={reduced ? undefined : 'notepad-desk-lamp'}
            aria-hidden
            className="absolute inset-x-4 -top-px h-1 rounded-full bg-primary shadow-elevation-2"
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 32 }}
          />
        )}
        {selected && (
          <span className={`absolute inset-y-3 left-0 w-0.5 rounded-full ${meta.tone.fill}`} aria-hidden />
        )}
        <AnimatePresence>{working.kind && <WorkingEdge key={working.kind} working={working} />}</AnimatePresence>

        <div className="flex items-center justify-between gap-2">
          <NoteProjectPicker note={note} projects={projects} onSelect={(projectId) => onPatch({ projectId })} />
          <div className="flex items-center gap-1 shrink-0">
            <NoteThreadButton
              noteId={note.id}
              noteTitle={note.title}
              open={threadOpen}
              onOpenChange={setThreadOpen}
              quietWhenRead
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
          <span className="block typo-title-lg line-clamp-2">
            {titleHit ? (
              <>
                {titleHit.pre}
                <mark className="bg-primary/25 text-foreground rounded-input px-0.5">{titleHit.hit}</mark>
                {titleHit.post}
              </>
            ) : (
              note.title
            )}
          </span>
        </button>
        {selected && (
          <span className="sr-only">{t.notepad.desk_selected_note}</span>
        )}

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
          rail={<NoteLifecycleRail note={note} shown={railShown} onAdvance={advance} />}
        />
      </RevealItem>

      <AnimatePresence>
        {bubbleEntry && !threadOpen && (
          <NoteCardBubble
            key={bubbleEntry.id}
            entry={bubbleEntry}
            intent={bubbleIntent}
            onDismiss={dismissBubble}
            onRead={() => {
              dismissBubble();
              setThreadOpen(true);
            }}
          />
        )}
      </AnimatePresence>

      {menu && (
        <NoteCardMenu
          note={note}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          handlers={{
            onOpen,
            onAsk: () => setAsk(menu),
            onPublish: () => void run(() => publishFleet(note, project)),
            onToGoals: () => void run(() => toGoals(note, project)),
            onArchive: () => void archiveNote(note.id),
            onDelete,
          }}
        />
      )}
      {ask && <NoteAskQuickInput note={note} x={ask.x} y={ask.y} onClose={() => setAsk(null)} />}
    </div>
  );
}
