// A deliberately small markdown editor: a textarea with two behaviours, and a
// rendered read view.
//
// It exists because the alternative was a rich-text component. The stored value
// stays PLAIN MARKDOWN — the same text an agent reads out of the database and
// the same text `MarkdownRenderer` already draws everywhere else in this app.
// A WYSIWYG surface would have had to store HTML or a document model, and then
// every consumer that reads the field (Athena's `describe_ship_milestone`, an
// export, a diff) would need to understand that format too. Two keystrokes are
// not worth a second content type.
//
// What it does, and nothing more:
//   · Ctrl/Cmd+B wraps the selection in `**` (or unwraps it if already bold,
//     because a toggle that only toggles one way is a trap).
//   · Enter on a `- ` line continues the list; Enter on an EMPTY bullet ends it
//     and removes the marker, which is what every editor with lists does and
//     what a user will try without being told.
//
// Everything else markdown can do still works — it is markdown — it just is not
// bound to a key.
import { forwardRef, useImperativeHandle, useRef, type KeyboardEvent } from 'react';

import { MarkdownRenderer } from './MarkdownRenderer';

/** Matches a list line and splits it into indent, marker, and content. */
const BULLET = /^(\s*)([-*])(\s+)(.*)$/;

export interface MarkdownMiniEditorHandle {
  focus: () => void;
}

export interface MarkdownMiniEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired on blur — the caller decides whether the value actually changed. */
  onCommit?: () => void;
  /** Escape pressed: the caller reverts and leaves edit mode. */
  onCancel?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  className?: string;
  testId?: string;
}

/**
 * Apply a text edit to a textarea and keep the caret where the user expects.
 *
 * React controlled inputs reset the selection to the end on re-render, so any
 * edit that inserts text before the caret would otherwise send the cursor to
 * the bottom of the field on every keystroke. The rAF restores it after the
 * commit paints.
 */
function applyEdit(
  el: HTMLTextAreaElement,
  next: string,
  caret: number,
  onChange: (v: string) => void,
): void {
  onChange(next);
  requestAnimationFrame(() => {
    el.selectionStart = caret;
    el.selectionEnd = caret;
  });
}

export const MarkdownMiniEditor = forwardRef<MarkdownMiniEditorHandle, MarkdownMiniEditorProps>(
  function MarkdownMiniEditor(
    { value, onChange, onCommit, onCancel, placeholder, ariaLabel, rows = 4, className, testId },
    ref,
  ) {
    const taRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }), []);

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
        return;
      }

      // ── Ctrl/Cmd+B — bold the selection, or unbold it.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b } = el;
        const selected = value.slice(a, b);
        const wrappedOutside = value.slice(a - 2, a) === '**' && value.slice(b, b + 2) === '**';

        if (wrappedOutside) {
          // The markers sit outside the selection — the user selected the words
          // and pressed the key again.
          applyEdit(el, value.slice(0, a - 2) + selected + value.slice(b + 2), a - 2 + selected.length, onChange);
          return;
        }
        if (selected.length >= 4 && selected.startsWith('**') && selected.endsWith('**')) {
          const inner = selected.slice(2, -2);
          applyEdit(el, value.slice(0, a) + inner + value.slice(b), a + inner.length, onChange);
          return;
        }
        // Empty selection still bolds: it leaves `****` with the caret in the
        // middle, so the key works as "start typing bold" and not just as
        // "bold what I already wrote".
        applyEdit(el, `${value.slice(0, a)}**${selected}**${value.slice(b)}`, a + 2 + selected.length, onChange);
        return;
      }

      // ── Enter — continue or end a bullet list.
      if (e.key === 'Enter' && !e.shiftKey && el.selectionStart === el.selectionEnd) {
        const caret = el.selectionStart;
        const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
        const line = value.slice(lineStart, caret);
        const m = BULLET.exec(line);
        if (!m) return; // ordinary newline

        // Destructured with defaults: every group in BULLET is mandatory, so a
        // match guarantees them — but `noUncheckedIndexedAccess` types them as
        // possibly-undefined and an empty string is the correct read anyway.
        const [, indent = '', marker = '-', gap = ' ', content = ''] = m;
        if (content.trim() === '') {
          // Enter on an empty bullet ENDS the list and clears the marker,
          // rather than adding a second empty one.
          e.preventDefault();
          applyEdit(el, value.slice(0, lineStart) + value.slice(caret), lineStart, onChange);
          return;
        }
        e.preventDefault();
        const insert = `\n${indent}${marker}${gap}`;
        applyEdit(el, value.slice(0, caret) + insert + value.slice(caret), caret + insert.length, onChange);
      }
    };

    return (
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
        rows={rows}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className}
        data-testid={testId}
        spellCheck
      />
    );
  },
);

/**
 * The read view. Same renderer the rest of the app uses, so a bold run or a
 * bullet list looks identical here and in Athena's chat.
 */
export function MarkdownMiniView({ content, className }: { content: string; className?: string }) {
  return <MarkdownRenderer content={content} className={className} />;
}
