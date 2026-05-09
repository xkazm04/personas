import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { Pencil } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';

/* InlineEditableText — discoverable rename affordance, identical pattern everywhere.
 *
 * Renders text by default. On group-hover, fades in a pencil icon. Click the
 * text or the icon to enter edit mode: the text morphs into an unstyled input
 * sized to match the original glyph metrics so width does not jitter on
 * transition. Commit on Enter or blur, revert on Escape.
 *
 * Designed to slot into any text element where rename is the obvious next
 * action — table name cells, card titles, calendar event labels, header
 * text. The pencil is the affordance; the click is the action.
 *
 * The wrapper exposes `group` so consumer surfaces (cells, cards) can also
 * react to hover (e.g. row highlight) — pass `parentGroup` if the consumer
 * wants the pencil to react to a *parent* group's hover instead.
 */

export interface InlineEditableTextProps {
  /** Current text value. */
  value: string;
  /** Called when the user commits a non-empty, changed value. Awaited so
   *  consumers can show pending state via `loading` prop if needed. */
  onCommit: (next: string) => void | Promise<void>;
  /** Optional placeholder when value is empty in edit mode. */
  placeholder?: string;
  /** Aria-label for the pencil button. Defaults to t.common.rename. */
  renameLabel?: string;
  /** Render-mode className. Should match the surrounding text style so
   *  the input morph is visually continuous. */
  className?: string;
  /** Inline style applied to text + input — primarily for color tinting. */
  style?: CSSProperties;
  /** Disable the affordance entirely (e.g. for read-only personas). */
  disabled?: boolean;
  /** Maximum allowed length, enforced by the input's maxLength attribute. */
  maxLength?: number;
  /** Custom onClick for the text node when NOT in edit mode (e.g. open a
   *  detail view). The pencil click is independent and always enters edit. */
  onTextClick?: () => void;
  /** Optional content rendered inline AFTER the text but BEFORE the pencil
   *  (e.g. a tag chip). Hidden in edit mode. */
  trailing?: React.ReactNode;
  /** When true, the parent already provides `group` — consumer surfaces that
   *  want the pencil tied to their own hover, not the local wrapper. */
  parentGroup?: boolean;
}

const SHARED_TYPO = 'typo-body font-medium';

export function InlineEditableText({
  value,
  onCommit,
  placeholder,
  renameLabel,
  className = '',
  style,
  disabled,
  maxLength,
  onTextClick,
  trailing,
  parentGroup,
}: InlineEditableTextProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep draft in sync when the upstream value changes (e.g. after a save).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useLayoutEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const enterEdit = () => {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== value) {
      void onCommit(trimmed);
    } else {
      setDraft(value);
    }
  };

  const revert = () => {
    setDraft(value);
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      revert();
    }
  };

  const groupClass = parentGroup ? '' : 'group';
  const pencilLabel = renameLabel ?? t.common.rename;

  return (
    <span className={`inline-flex items-center gap-1 min-w-0 ${groupClass}`}>
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.input
            key="input"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            maxLength={maxLength}
            className={`${SHARED_TYPO} ${className} bg-transparent border-b border-primary/40 outline-none focus-visible:border-primary px-0 min-w-0 max-w-full`}
            style={style}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            // Preserve click events from bubbling (some parents have row-level click handlers).
            onClick={(e) => e.stopPropagation()}
            aria-label={pencilLabel}
          />
        ) : (
          <motion.span
            key="text"
            className={`${SHARED_TYPO} ${className} truncate min-w-0 ${onTextClick ? 'cursor-pointer hover:text-primary transition-colors' : ''}`}
            style={style}
            onClick={(e) => {
              if (onTextClick) {
                e.stopPropagation();
                onTextClick();
              }
            }}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          >
            {value}
          </motion.span>
        )}
      </AnimatePresence>

      {!editing && trailing}

      {!editing && !disabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            enterEdit();
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-0.5 text-foreground/50 hover:text-foreground focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
          aria-label={pencilLabel}
          tabIndex={-1}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}
