import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';

import { applyCardDensity, cardDomToMarkdown, renderCardMarkdown } from '../../cardMarkdown';
import { applyInputRule, ensureChecklistBoxes, placeCaretAtEnd, toggleHeading } from './cardInputRules';

interface CardRichTextProps {
  /** Stored markdown. */
  value: string;
  onChange: (markdown: string) => void;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
  ariaLabel: string;
  placeholder: string;
  testId?: string;
}

/**
 * A card's note as formatted, editable text — no markdown syntax on screen,
 * at rest or while typing. See `cardMarkdown.ts` for the subset and
 * `cardInputRules.ts` for how typed markers become formatting.
 *
 * The DOM is the source of truth WHILE FOCUSED: every input serializes it to
 * markdown and reports it, and a new `value` is written back into the DOM only
 * when it is not ours and the caret is elsewhere — re-rendering under a typing
 * hand would throw the caret to the start.
 */
export function CardRichText({
  value,
  onChange,
  onFocusChange,
  autoFocus = false,
  ariaLabel,
  placeholder,
  testId,
}: CardRichTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === lastEmitted.current || document.activeElement === el) return;
    renderCardMarkdown(el, value);
    lastEmitted.current = value;
  }, [value]);

  useEffect(() => {
    if (!autoFocus || !ref.current) return;
    ref.current.focus();
    placeCaretAtEnd(ref.current);
  }, [autoFocus]);

  const emit = (el: HTMLDivElement) => {
    const markdown = cardDomToMarkdown(el);
    if (markdown === lastEmitted.current) return;
    lastEmitted.current = markdown;
    onChange(markdown);
  };

  const onInput = (e: FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    applyInputRule(e.nativeEvent as InputEvent, el);
    ensureChecklistBoxes(el);
    applyCardDensity(el);
    emit(el);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Handled here, so the pad's own Escape leaves the card open.
      e.preventDefault();
      e.currentTarget.blur();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b' || key === 'i') document.execCommand(key === 'b' ? 'bold' : 'italic');
    else if (key === '1' || key === '2' || key === '3') toggleHeading(Number(key) as 1 | 2 | 3);
    else return;
    e.preventDefault();
    applyCardDensity(e.currentTarget);
    emit(e.currentTarget);
  };

  // Paste as plain text: rich markup from elsewhere is not in the stored subset.
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto -mx-1.5 px-1.5 rounded-input focus-within:bg-secondary/15 transition-colors">
      {value.trim() === '' && (
        <span aria-hidden className="pointer-events-none absolute left-1.5 top-0 typo-body text-foreground/50">
          {placeholder}
        </span>
      )}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        spellCheck
        data-testid={testId}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        // A checkbox toggles without an input event; its state is part of the note.
        onClick={(e) => {
          if (e.target instanceof HTMLInputElement) emit(e.currentTarget);
        }}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        className="relative min-h-full outline-none typo-body text-foreground break-words cursor-text"
      />
    </div>
  );
}
