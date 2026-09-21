/* eslint-disable custom/enforce-base-modal --
 * The composer is a one-field popover docked under its card, not a modal: no
 * backdrop, outside-press and Escape dismiss it, and the card it talks about
 * stays visible above it (same exemption as the baseline NoteAskQuickInput). */
// ONE composer for the three things you say to a note from the desk, docked
// under the selected card:
//
//   ask     `a` / menu "Ask Athena…" → `askAthena(note, focus)` — the same door as
//           the dispatch bar, so the card's presence chip lights.
//   reply   `r`                      → `commentOnNote` — the thread's own door.
//   reject  `n` on a RUN review      → `rejectReview(comment, reason)` — the reason
//           is required (it is what the re-run is told), exactly as the
//           baseline's reason form requires it.
//
// It is a popover, not a modal: no backdrop, the card it talks about stays in
// view above it, outside-press and Escape dismiss it. Escape is CLAIMED, so the
// pad's ladder never also steps back a layer.
import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquareReply, SendHorizontal, Sparkles, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import { useToastStore } from '@/stores/toastStore';

import { askAthena } from '../../../notepadActions';
import { commentOnNote, rejectReview } from '../../../thread/threadActions';
import { threadAuthorLabel } from '../../../thread/threadLabels';
import { COPY } from './copy';
import { Keycap } from './Keycap';

export type ComposerMode = 'ask' | 'reply' | 'reject';

export interface ComposerRequest {
  noteId: string;
  mode: ComposerMode;
  /** reply: the entry being answered (for the context line); reject: the review. */
  entry?: NoteComment;
}

const TONE: Record<ComposerMode, { border: string; icon: string }> = {
  ask: { border: 'border-brand-purple/40', icon: 'text-brand-purple' },
  reply: { border: 'border-primary/35', icon: 'text-primary' },
  reject: { border: 'border-status-error/40', icon: 'text-status-error' },
};

export function CardComposer({
  note,
  project,
  request,
  onClose,
}: {
  note: DevNote;
  project: DevProject | null;
  request: ComposerRequest;
  /** `sent` is true when the composer closes because its message landed. */
  onClose: (sent: boolean) => void;
}) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const ref = useRef<HTMLFormElement>(null);
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);
  const inFlight = useRef(false);
  const { mode, entry } = request;
  const tone = TONE[mode];

  useClickOutside(ref, true, () => onClose(false), { claimEscape: true });

  const send = async () => {
    if (inFlight.current) return;
    const body = text.trim();
    if (mode !== 'ask' && !body) {
      setMissing(mode === 'reject');
      return;
    }
    inFlight.current = true;
    try {
      if (mode === 'ask') {
        const r = await askAthena(note, body || undefined);
        if (r.ok) {
          useToastStore.getState().addToast(t.notepad.ask_athena_sent, 'success');
          onClose(true);
        }
      } else if (mode === 'reply') {
        const r = await commentOnNote({ id: note.id }, body);
        if (r.ok) onClose(true);
      } else if (entry) {
        const r = await rejectReview(entry, body, { project });
        if (r.ok) {
          useToastStore.getState().addToast(t.notepad.review_rework_sent, 'success');
          onClose(true);
        } else if (r.pending) {
          setMissing(true);
        }
      }
    } finally {
      inFlight.current = false;
    }
  };

  const Icon = mode === 'ask' ? Sparkles : mode === 'reply' ? MessageSquareReply : X;
  const heading =
    mode === 'ask'
      ? COPY.compose_ask_title
      : mode === 'reply'
        ? entry
          ? tx(COPY.replying_to, { author: threadAuthorLabel(entry, t.notepad, tx) })
          : COPY.compose_reply_title
        : t.notepad.review_reject_reason_label;
  const placeholder =
    mode === 'ask'
      ? t.notepad.menu_ask_placeholder
      : mode === 'reply'
        ? t.notepad.bubble_comment_placeholder
        : t.notepad.review_reject_reason_placeholder;

  return (
    <motion.form
      ref={ref}
      role="dialog"
      aria-label={heading}
      data-testid={`notepad-v2c-composer-${note.id}`}
      data-mode={mode}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34 }}
      style={{ transformOrigin: 'top center' }}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className={`absolute inset-x-0 top-full mt-2 z-30 flex flex-col gap-1.5 px-3 pt-2 pb-2.5 rounded-card border bg-background/95 backdrop-blur-md shadow-elevation-4 ${tone.border}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${tone.icon}`} aria-hidden />
        <span className="typo-label text-foreground truncate">{heading}</span>
        <span className="ml-auto flex items-center gap-1 shrink-0 typo-caption text-foreground/85">
          <Keycap>↵</Keycap>
          {COPY.hint_send}
          <Keycap className="ml-1">{COPY.keycap_esc}</Keycap>
          {COPY.hint_close}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (missing) setMissing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Ends the ladder here: the composer closes, the desk stays.
              e.preventDefault();
              e.stopPropagation();
              onClose(false);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={missing}
          data-testid={`notepad-v2c-composer-input-${note.id}`}
          className="flex-1 min-w-0 h-8 px-2.5 typo-body rounded-input border border-primary/15 bg-secondary/20 text-foreground placeholder:text-foreground/60 outline-none focus:border-primary/35"
        />
        <AsyncButton
          variant={mode === 'reject' ? 'danger' : 'primary'}
          size="icon-sm"
          aria-label={mode === 'reject' ? t.notepad.review_reject_submit : t.notepad.thread_send}
          icon={<SendHorizontal className="w-3.5 h-3.5" />}
          onClick={send}
          data-testid={`notepad-v2c-composer-send-${note.id}`}
        />
      </div>
      {mode === 'reject' && (
        <span
          className={`typo-caption ${missing ? 'text-status-warning' : 'text-foreground/85'}`}
          role={missing ? 'alert' : undefined}
        >
          {missing ? t.notepad.review_reject_reason_required : t.notepad.review_reject_rerun_hint}
        </span>
      )}
    </motion.form>
  );
}
