/* eslint-disable custom/enforce-base-modal --
 * An anchored confirmation next to the control that asked, not a centred
 * modal: a BaseModal backdrop would hide the very thing being confirmed.
 * role="dialog" + aria-labelledby give it the right semantics. */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { useAnchoredPortalPosition } from '@/features/shared/components/forms/useAnchoredPortalPosition';

export interface ConfirmPopoverProps {
  open: boolean;
  /** The control that asked. The popover anchors under it (above when tight) and returns focus to it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The question, one line. */
  title: string;
  /** Optional second line: the consequence, or the numbers behind the choice. */
  detail?: ReactNode;
  confirmLabel: string;
  /** Defaults to `t.common.cancel`. */
  cancelLabel?: string;
  confirmIcon?: ReactNode;
  /** `danger` for an irreversible action: red confirm, focus starts on Cancel. */
  tone?: 'primary' | 'danger';
  /**
   * May return a promise; while it is pending the confirm shows a real spinner
   * and Cancel, Esc and outside presses are ignored, so the action cannot be
   * abandoned half-way or fired twice. The caller closes the popover.
   */
  onConfirm: () => unknown;
  onCancel: () => void;
  /** Which edge of the anchor the popover lines up with. Defaults to `end` (header keys sit at the right). */
  align?: 'start' | 'end';
  width?: number;
  testId?: string;
  confirmTestId?: string;
}

const DEFAULT_WIDTH = 320;
const EDGE = 8;

/**
 * @catalog Anchored confirm popover next to the control that asked: a title, an optional detail line, Cancel and an AsyncButton confirm with a real spinner and a danger tone for irreversible actions. Esc or an outside press closes it, focus moves in and returns to the trigger. Prefer it to a ConfirmDialog modal for a header key or a row action.
 */
export function ConfirmPopover({
  open,
  anchorRef,
  title,
  detail,
  confirmLabel,
  cancelLabel,
  confirmIcon,
  tone = 'primary',
  onConfirm,
  onCancel,
  align = 'end',
  width = DEFAULT_WIDTH,
  testId,
  confirmTestId,
}: ConfirmPopoverProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const pos = useAnchoredPortalPosition(anchorRef, open, { flip: true, maxMenuHeight: 180, gap: 6 });

  const dismiss = useCallback(() => {
    if (busy) return;
    onCancel();
  }, [busy, onCancel]);

  useClickOutside([anchorRef, panelRef], open, dismiss);
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      dismiss();
      return true;
    },
    { enabled: open, priority: OVERLAY_DISMISS_PRIORITY },
  );

  // Focus moves in on open (Cancel first when the action cannot be undone) and
  // back to the trigger on close, so a keyboard user never lands on <body>.
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const target = tone === 'danger' ? cancelRef.current : confirmRef.current;
    target?.focus({ preventScroll: true });
  }, [open, placed, tone]);
  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    return () => {
      // Only when focus was left with nowhere to go (it sat in the popover,
      // which is gone). A press on another control keeps that control focused.
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && anchor && document.contains(anchor)) anchor.focus({ preventScroll: true });
    };
  }, [open, anchorRef]);

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }, [onConfirm]);

  // Two buttons: Tab and Shift+Tab cycle between them instead of leaving the popover.
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open || !pos) return null;

  const rawLeft = align === 'end' ? pos.left + pos.width - width : pos.left;
  const left = Math.max(EDGE, Math.min(rawLeft, window.innerWidth - width - EDGE));

  return createPortal(
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid={testId}
      onKeyDown={trapTab}
      initial={reduceMotion ? false : { opacity: 0, y: pos.flipUp ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      style={{
        top: pos.flipUp ? undefined : pos.top,
        bottom: pos.flipUp ? window.innerHeight - pos.top : undefined,
        left,
        width,
      }}
      className={`fixed z-[9995] rounded-card border bg-background shadow-elevation-4 p-3.5 ${
        tone === 'danger' ? 'border-status-error/30' : 'border-primary/20'
      }`}
    >
      <p id={titleId} className="typo-body text-foreground">
        {title}
      </p>
      {detail ? <div className="mt-1 typo-caption text-foreground">{detail}</div> : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button ref={cancelRef} variant="ghost" size="sm" onClick={dismiss} disabled={busy} className="whitespace-nowrap">
          {cancelLabel ?? t.common.cancel}
        </Button>
        <AsyncButton
          ref={confirmRef}
          variant={tone === 'danger' ? 'danger' : 'primary'}
          size="sm"
          icon={confirmIcon}
          onClick={handleConfirm}
          data-testid={confirmTestId}
          className="whitespace-nowrap"
        >
          {confirmLabel}
        </AsyncButton>
      </div>
    </motion.div>,
    document.body,
  );
}
