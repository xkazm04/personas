import { useEffect, useRef } from 'react';
import type { DocumentBlock } from './documentModel';

interface DocumentRowEditorProps {
  block: DocumentBlock;
  /** The row's editable part: its text without bullet, indent or `#` marker. */
  value: string;
  /** Where the caret lands on open: an offset in `value`, or 'end'. */
  caret: number | 'end';
  label: string;
  onChange: (next: string) => void;
  /** Enter: split this row at the caret into two sibling rows. */
  onSplit: (caret: number) => void;
  /** Backspace at the start of an empty row: remove it. */
  onRemove: () => void;
  /** Up at the first line / Down at the last: move writing to the next row. */
  onMove: (delta: -1 | 1) => void;
  onStopWriting: () => void;
  onSave: () => void;
}

/**
 * @catalog DocumentRowEditor — one row of a DocumentSurface chapter, edited in place: the clicked bullet or paragraph becomes a field in the same reading type while its bullet stays rendered and every other row stays as it was. Part of DocumentSurface, not a standalone primitive.
 *
 * ONE ROW, NOT THE CHAPTER. This is the behaviour the owner named out of the
 * contest field twice: a click on a line puts the caret in THAT line, in place.
 * The first promotion opened the whole chapter as raw markdown instead — the
 * rows the reader had been reading turned into `- ` and backticks, which is
 * the mode swap the brief ruled out.
 *
 * It is safe because nothing is re-serialised: the field holds only the row's
 * editable part, and every edit is a splice over the exact span the row came
 * from (`spliceRow` in `documentModel`). The bullet, the indent and a `##`
 * marker live outside the field and cannot be typed away.
 *
 *   Enter          split the row at the caret (a new bullet after a bullet)
 *   Shift+Enter    a line break inside the row
 *   Up / Down      at the edge of the row, move to the previous / next row
 *   Backspace      on an empty row, remove it and move up
 *   Esc            step out, keep the draft
 *   Ctrl/Cmd+Enter save the chapter whole
 */
export function DocumentRowEditor({
  block,
  value,
  caret,
  label,
  onChange,
  onSplit,
  onRemove,
  onMove,
  onStopWriting,
  onSave,
}: DocumentRowEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Focus and place the caret when THIS row opens; a keystroke that stays on
  // the row must not move the caret back.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const at = caret === 'end' ? el.value.length : Math.min(caret, el.value.length);
    el.setSelectionRange(at, at);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run per row, not per keystroke
  }, [block.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      aria-label={label}
      className="ds-editor ds-row-editor"
      data-testid={`document-row-editor-${block.id}`}
      onChange={(e) => onChange(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const el = e.currentTarget;
        const start = el.selectionStart;
        const collapsed = start === el.selectionEnd;
        if (e.key === 'Escape') {
          e.preventDefault();
          onStopWriting();
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSave();
        } else if (e.key === 'Enter' && e.shiftKey && block.kind === 'item') {
          // keep the continuation indented so it stays inside this bullet
          e.preventDefault();
          const next = `${value.slice(0, start)}\n${' '.repeat(block.indent + 2)}${value.slice(el.selectionEnd)}`;
          onChange(next);
          requestAnimationFrame(() => el.setSelectionRange(start + block.indent + 3, start + block.indent + 3));
        } else if (e.key === 'Enter' && !e.shiftKey && block.kind !== 'code') {
          e.preventDefault();
          onSplit(start);
        } else if (e.key === 'Backspace' && collapsed && start === 0 && value === '') {
          e.preventDefault();
          onRemove();
        } else if (e.key === 'ArrowUp' && collapsed && !value.slice(0, start).includes('\n')) {
          e.preventDefault();
          onMove(-1);
        } else if (e.key === 'ArrowDown' && collapsed && !value.slice(start).includes('\n')) {
          e.preventDefault();
          onMove(1);
        }
      }}
    />
  );
}
