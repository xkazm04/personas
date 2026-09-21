// The thread's two controls, shared by every surface that shows an entry — the
// popover, the card bubble and the LiveCommsStack row — so Approve / Reject and
// "reply" behave identically wherever the operator meets them.
//
// Every verb is an `AsyncButton` whose onClick RETURNS the promise: the spinner
// belongs to the control that was pressed (the action half of the spinner
// boundary), and the double-submit guard only holds when the promise reaches it.
import { useRef, useState, type KeyboardEvent } from 'react';
import { Check, SendHorizontal, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import { useToastStore } from '@/stores/toastStore';

import { approveReview, commentOnNote, rejectReview } from './threadActions';

/**
 * Approve / Reject for a PENDING review.
 *
 * A suggestion-card review rejects in one tap (the server takes no reason for
 * it). A `run` review's Reject opens a reason field first — the reason is what
 * the re-run is told, and an empty one would re-run the same brief (the
 * ping-pong risk the brief names), so the send stays refused until it is typed.
 */
export function ReviewVerdictActions({
  comment,
  size = 'xs',
  testIdPrefix,
  onSettled,
}: {
  comment: NoteComment;
  size?: 'xs' | 'sm';
  /** `data-testid` stem — `${prefix}-approve`, `-reject`, `-reason`, `-reject-submit`. */
  testIdPrefix: string;
  /** After a verdict landed (either one). */
  onSettled?: () => void;
}) {
  const { t } = useTranslation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const isRun = comment.refKind === 'run';
  const isCard = comment.refKind === 'suggestion_card';

  const approve = async () => {
    const r = await approveReview(comment);
    if (r.ok) onSettled?.();
  };

  const rejectNow = async () => {
    const r = await rejectReview(comment);
    if (r.ok) onSettled?.();
  };

  const submitReject = async () => {
    const why = reason.trim();
    if (!why) {
      setMissing(true);
      return;
    }
    const r = await rejectReview(comment, why);
    if (r.ok) {
      useToastStore.getState().addToast(t.notepad.review_rework_sent, 'success');
      setRejecting(false);
      setReason('');
      onSettled?.();
    } else if (r.pending) {
      setMissing(true);
    }
  };

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1.5" data-testid={`${testIdPrefix}-reject-form`}>
        <label className="typo-caption text-foreground/85" htmlFor={`${testIdPrefix}-reason`}>
          {t.notepad.review_reject_reason_label}
        </label>
        <textarea
          id={`${testIdPrefix}-reason`}
          value={reason}
          rows={2}
          autoFocus
          onChange={(e) => {
            setReason(e.target.value);
            if (missing) setMissing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // Ends the ladder here: the field closes, the surface under it stays.
              e.preventDefault();
              e.stopPropagation();
              setRejecting(false);
            }
          }}
          placeholder={t.notepad.review_reject_reason_placeholder}
          aria-invalid={missing}
          data-testid={`${testIdPrefix}-reason`}
          className="w-full px-2.5 py-1.5 typo-body rounded-input border border-primary/15 bg-background/70 text-foreground placeholder:text-foreground/60 focus:outline-none focus:border-primary/35 resize-none"
        />
        {missing ? (
          <span className="typo-caption text-status-warning" role="alert">
            {t.notepad.review_reject_reason_required}
          </span>
        ) : (
          <span className="typo-caption text-foreground/85">{t.notepad.review_reject_rerun_hint}</span>
        )}
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="ghost" size={size} onClick={() => setRejecting(false)} data-testid={`${testIdPrefix}-reject-cancel`}>
            {t.notepad.review_cancel}
          </Button>
          <AsyncButton variant="danger" size={size} onClick={submitReject} data-testid={`${testIdPrefix}-reject-submit`}>
            {t.notepad.review_reject_submit}
          </AsyncButton>
        </div>
      </div>
    );
  }

  const approveButton = (
    <AsyncButton
      variant="primary"
      size={size}
      icon={<Check className="w-3.5 h-3.5" />}
      onClick={approve}
      data-testid={`${testIdPrefix}-approve`}
    >
      {t.notepad.review_approve}
    </AsyncButton>
  );
  const rejectButton = isRun ? (
    <Button
      variant="secondary"
      size={size}
      icon={<X className="w-3.5 h-3.5" />}
      onClick={() => setRejecting(true)}
      data-testid={`${testIdPrefix}-reject`}
    >
      {t.notepad.review_reject}
    </Button>
  ) : (
    <AsyncButton
      variant="secondary"
      size={size}
      icon={<X className="w-3.5 h-3.5" />}
      onClick={rejectNow}
      data-testid={`${testIdPrefix}-reject`}
    >
      {t.notepad.review_reject}
    </AsyncButton>
  );

  return (
    <div className="flex items-center gap-1.5">
      {isCard ? <Tooltip content={t.notepad.review_approve_all_hint}>{approveButton}</Tooltip> : approveButton}
      {isCard ? <Tooltip content={t.notepad.review_reject_all_hint}>{rejectButton}</Tooltip> : rejectButton}
    </div>
  );
}

/**
 * One-line (or, in the popover, multi-line) comment composer. Enter sends;
 * Shift+Enter is a newline in the multi-line form. The text is cleared only
 * once the comment is STORED — a failed send keeps what the operator typed.
 */
export function ThreadComposer({
  noteId,
  multiline = false,
  autoFocus = false,
  testIdPrefix,
  onSent,
  onCancel,
}: {
  noteId: string;
  multiline?: boolean;
  autoFocus?: boolean;
  testIdPrefix: string;
  onSent?: () => void;
  /** Escape in the field. When absent Escape is left to the surface. */
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  // Enter reaches `send` without the button, so it needs the button's guard:
  // one comment per press, however fast the key repeats.
  const inFlight = useRef(false);

  const send = async () => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true;
    const r = await commentOnNote({ id: noteId }, text).finally(() => {
      inFlight.current = false;
    });
    if (r.ok) {
      setText('');
      onSent?.();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const fieldClass =
    'flex-1 min-w-0 px-2.5 py-1.5 typo-body rounded-input border border-primary/15 bg-background/70 text-foreground placeholder:text-foreground/60 focus:outline-none focus:border-primary/35';
  const placeholder = multiline ? t.notepad.thread_composer_placeholder : t.notepad.bubble_comment_placeholder;

  return (
    <div className="flex items-end gap-1.5">
      {multiline ? (
        <textarea
          value={text}
          rows={2}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={t.notepad.thread_composer_label}
          data-testid={`${testIdPrefix}-input`}
          className={`${fieldClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={t.notepad.thread_composer_label}
          data-testid={`${testIdPrefix}-input`}
          className={fieldClass}
        />
      )}
      <AsyncButton
        variant="primary"
        size="icon-sm"
        aria-label={t.notepad.thread_send}
        disabled={!text.trim()}
        icon={<SendHorizontal className="w-3.5 h-3.5" />}
        onClick={send}
        data-testid={`${testIdPrefix}-send`}
      />
    </div>
  );
}
