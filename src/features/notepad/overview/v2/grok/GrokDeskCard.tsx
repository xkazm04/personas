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

import { archiveNote, type NotePatch, type NoteSaveState } from '../../../notepadStore';
import { noteStatusMeta } from '../../../noteStatusMeta';
import { publishFleet, toGoals, type NoteDispatchResult } from '../../../notepadActions';
import { noteAskBlockedReasonKey, noteDeleteBlocked } from '../../../noteGuards';
import { resultSummary } from '../../../noteText';
import { registerVisibleCard } from '../../../thread/cardVisibility';
import { NoteThreadButton } from '../../../thread/NoteThreadButton';
import { approveReview, rejectReview } from '../../../thread/threadActions';
import { isPendingReview } from '../../../thread/threadLabels';
import type { NoteWorking } from '../../../thread/useNoteWorking';
import type { DeskForecast } from '../../deskForecast';
import { NoteCardBubble, useCardBubble } from '../../parts/NoteCardBubble';
import { GoalsBar, NoteCardFooter, NoteStatusGlyph, PlanStampBadge } from '../../parts/NoteCardBits';
import { NoteAskQuickInput, NoteCardMenu } from '../../parts/NoteCardMenu';
import { NoteLifecycleRail, type RailNext } from '../../parts/NoteLifecycleRail';
import { NotePresenceChip, WorkingEdge } from '../../parts/NotePresenceChip';
import { NoteProjectPicker } from '../../parts/NoteProjectPicker';
import { NoteQuickWrite } from '../../parts/NoteQuickWrite';
import { grokCopy } from './copy';
import { splitHighlight, type CardAction } from './deskModel';

export interface CardCommand {
  seq: number;
  kind: CardAction;
}

interface GrokDeskCardProps {
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
  query: string;
  command: CardCommand | null;
  onSelect: () => void;
  onPendingReview?: (pending: boolean) => void;
  onOpen: () => void;
  onPatch: (patch: NotePatch) => void;
  onDelete: () => void;
  onCertify: () => void;
}

const IDLE: NoteWorking = { kind: null, since: null, label: null, elapsedTemplate: null };

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function GrokDeskCard({
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
  query,
  command,
  onSelect,
  onPendingReview,
  onOpen,
  onPatch,
  onDelete,
  onCertify,
}: GrokDeskCardProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const meta = noteStatusMeta(note.status);
  const summaryStamped = Boolean(summary && (summary.cutAt || summary.shippedAt));
  const result = note.status === 'completed' ? resultSummary(note.resultJson) : null;
  const project = projects.find((p) => p.id === note.projectId) ?? null;
  const cardRef = useRef<HTMLDivElement>(null);
  const lastCommand = useRef(0);

  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [railFocused, setRailFocused] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [ask, setAsk] = useState<{ x: number; y: number } | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);
  const { entry: bubbleEntry, dismiss: dismissBubble } = useCardBubble(note.id);

  useEffect(() => registerVisibleCard(note.id), [note.id]);

  useEffect(() => {
    if (threadOpen) dismissBubble();
  }, [threadOpen, dismissBubble]);

  useEffect(() => {
    if (!selected) return;
    onPendingReview?.(Boolean(bubbleEntry && isPendingReview(bubbleEntry)));
  }, [selected, bubbleEntry, onPendingReview]);

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
      case 'reply':
        setThreadOpen(true);
        break;
      case 'approve':
        if (bubbleEntry && isPendingReview(bubbleEntry)) {
          void approveReview(bubbleEntry).then(() => dismissBubble());
        } else {
          setThreadOpen(true);
        }
        break;
      case 'reject':
        if (bubbleEntry && isPendingReview(bubbleEntry) && bubbleEntry.refKind === 'suggestion_card') {
          void rejectReview(bubbleEntry).then(() => dismissBubble());
        } else {
          setThreadOpen(true);
        }
        break;
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
  }, [command, openAskAtCard, bubbleEntry, dismissBubble, run, note, project, t, onDelete]);

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
        id={`grok-desk-card-${note.id}`}
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
            layoutId={reduced ? undefined : 'grok-desk-lamp'}
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
          <span className="block typo-title-lg text-foreground line-clamp-2">
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
          <span className="sr-only">{grokCopy.selectedAria}</span>
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
