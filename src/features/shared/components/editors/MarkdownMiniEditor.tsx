// A deliberately small markdown editor: a textarea with a handful of caret
// behaviours, an optional formatting toolbar, and a rendered read view.
//
// It exists because the alternative was a rich-text component. The stored value
// stays PLAIN MARKDOWN — the same text an agent reads out of the database and
// the same text `MarkdownRenderer` already draws everywhere else in this app.
// A WYSIWYG surface would have had to store HTML or a document model, and then
// every consumer that reads the field (Athena's `describe_ship_milestone`, an
// export, a diff) would need to understand that format too. A few keystrokes
// are not worth a second content type.
//
// What it does, and nothing more:
//   · Ctrl/Cmd+B / +I wrap the selection (and unwrap it if already wrapped,
//     because a toggle that only toggles one way is a trap).
//   · Ctrl/Cmd+1/2/3 toggle a heading on the touched lines.
//   · Enter on a `- ` line continues the list; Enter on an EMPTY bullet ends it
//     and removes the marker, which is what every editor with lists does and
//     what a user will try without being told.
//   · With `toolbar`, the same operations get buttons — the full set lives in
//     `MarkdownToolbar`, exported below so a host can place it elsewhere.
//   · With `preview`, a live rendered pane sits beside or under the textarea.
//
// DEFAULTS ARE THE OLD BEHAVIOUR. With no `toolbar` and `preview: 'none'` the
// component renders a bare `<textarea>` and nothing else, exactly as it did
// before those props existed — the existing Ship-tab consumer is untouched.
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Code,
  Quote,
} from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { MarkdownRenderer } from './MarkdownRenderer';
import { toggleHeading, toggleList, toggleWrap, type EditResult, type ListKind } from './markdownEdits';

/** Matches a list line and splits it into indent, marker, and content. */
const BULLET = /^(\s*)([-*])(\s+)(.*)$/;

export interface MarkdownMiniEditorHandle {
  focus: () => void;
}

/** How a rendered preview accompanies the textarea. */
export type MarkdownPreviewMode = 'none' | 'toggle' | 'split';

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
  /** Render the formatting toolbar above the textarea. */
  toolbar?: boolean;
  /** `'toggle'` adds a show/hide preview control; `'split'` always shows one. */
  preview?: MarkdownPreviewMode;
  /** Render the value read-only (no textarea, no toolbar) — for a note whose
   *  status has locked its body. */
  readOnly?: boolean;
  /** Wrapper classes when the component renders chrome (toolbar / preview). */
  containerClassName?: string;
  /** Classes for the rendered preview pane. */
  previewClassName?: string;
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
  caretEnd?: number,
): void {
  onChange(next);
  requestAnimationFrame(() => {
    el.selectionStart = caret;
    el.selectionEnd = caretEnd ?? caret;
  });
}

function applyResult(
  el: HTMLTextAreaElement,
  result: EditResult,
  onChange: (v: string) => void,
): void {
  applyEdit(el, result.value, result.selectionStart, onChange, result.selectionEnd);
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/** One formatting operation, expressed against the current selection. */
export type MarkdownEditOp =
  | { kind: 'wrap'; marker: string }
  | { kind: 'heading'; level: 1 | 2 | 3 }
  | { kind: 'list'; list: ListKind };

export function applyOp(op: MarkdownEditOp, value: string, start: number, end: number): EditResult {
  switch (op.kind) {
    case 'wrap':
      return toggleWrap(value, start, end, op.marker);
    case 'heading':
      return toggleHeading(value, start, end, op.level);
    default:
      return toggleList(value, start, end, op.list);
  }
}

export interface MarkdownToolbarProps {
  /** Runs the op against the live selection. The editor supplies this; a host
   *  placing the toolbar elsewhere gets the same contract. */
  onOp: (op: MarkdownEditOp) => void;
  disabled?: boolean;
  className?: string;
  /** Extra controls rendered at the trailing edge (e.g. a preview toggle). */
  trailing?: ReactNode;
}

/**
 * The formatting strip. Deliberately flat and unlabelled beyond its tooltips —
 * it is a hint that markdown is available, not the primary way to write it.
 */
export function MarkdownToolbar({ onOp, disabled, className, trailing }: MarkdownToolbarProps) {
  const { t } = useTranslation();

  const buttons: { id: string; title: string; icon: ReactNode; op: MarkdownEditOp }[] = [
    { id: 'bold', title: t.common.md_bold, icon: <Bold className="w-3.5 h-3.5" />, op: { kind: 'wrap', marker: '**' } },
    { id: 'italic', title: t.common.md_italic, icon: <Italic className="w-3.5 h-3.5" />, op: { kind: 'wrap', marker: '_' } },
    { id: 'h1', title: t.common.md_h1, icon: <Heading1 className="w-3.5 h-3.5" />, op: { kind: 'heading', level: 1 } },
    { id: 'h2', title: t.common.md_h2, icon: <Heading2 className="w-3.5 h-3.5" />, op: { kind: 'heading', level: 2 } },
    { id: 'h3', title: t.common.md_h3, icon: <Heading3 className="w-3.5 h-3.5" />, op: { kind: 'heading', level: 3 } },
    { id: 'bullet', title: t.common.md_bullet, icon: <List className="w-3.5 h-3.5" />, op: { kind: 'list', list: 'bullet' } },
    { id: 'numbered', title: t.common.md_numbered, icon: <ListOrdered className="w-3.5 h-3.5" />, op: { kind: 'list', list: 'numbered' } },
    { id: 'checklist', title: t.common.md_checklist, icon: <ListChecks className="w-3.5 h-3.5" />, op: { kind: 'list', list: 'checklist' } },
    { id: 'code', title: t.common.md_code, icon: <Code className="w-3.5 h-3.5" />, op: { kind: 'wrap', marker: '`' } },
    { id: 'quote', title: t.common.md_quote, icon: <Quote className="w-3.5 h-3.5" />, op: { kind: 'list', list: 'quote' } },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t.common.md_toolbar}
      className={`flex items-center gap-0.5 ${className ?? ''}`}
    >
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          disabled={disabled}
          data-testid={`md-toolbar-${b.id}`}
          aria-label={b.title}
          // `onMouseDown` + preventDefault: a click must not steal focus from
          // the textarea, or the selection the op reads is already gone.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onOp(b.op)}
          className="w-7 h-7 rounded-input flex items-center justify-center text-foreground/70 hover:text-foreground hover:bg-secondary/50 disabled:is-disabled transition-colors focus-ring"
        >
          {b.icon}
        </button>
      ))}
      {trailing}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export const MarkdownMiniEditor = forwardRef<MarkdownMiniEditorHandle, MarkdownMiniEditorProps>(
  function MarkdownMiniEditor(
    {
      value,
      onChange,
      onCommit,
      onCancel,
      placeholder,
      ariaLabel,
      rows = 4,
      className,
      testId,
      toolbar = false,
      preview = 'none',
      readOnly = false,
      containerClassName,
      previewClassName,
    },
    ref,
  ) {
    const { t } = useTranslation();
    const taRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => taRef.current?.focus() }), []);
    const [previewOpen, setPreviewOpen] = useState(false);

    const runOp = useCallback(
      (op: MarkdownEditOp) => {
        const el = taRef.current;
        if (!el) return;
        applyResult(el, applyOp(op, value, el.selectionStart, el.selectionEnd), onChange);
        el.focus();
      },
      [value, onChange],
    );

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;

      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel?.();
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        const key = e.key.toLowerCase();
        const op: MarkdownEditOp | null =
          key === 'b'
            ? { kind: 'wrap', marker: '**' }
            : key === 'i'
              ? { kind: 'wrap', marker: '_' }
              : key === '1'
                ? { kind: 'heading', level: 1 }
                : key === '2'
                  ? { kind: 'heading', level: 2 }
                  : key === '3'
                    ? { kind: 'heading', level: 3 }
                    : null;
        if (op) {
          e.preventDefault();
          applyResult(el, applyOp(op, value, el.selectionStart, el.selectionEnd), onChange);
          return;
        }
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

    if (readOnly) {
      return (
        <div data-testid={testId} aria-label={ariaLabel} className={containerClassName}>
          <MarkdownRenderer content={value} className={previewClassName ?? className} />
        </div>
      );
    }

    const textarea = (
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

    // Old contract, byte for byte: no chrome asked for, no chrome rendered.
    if (!toolbar && preview === 'none') return textarea;

    const showPreview = preview === 'split' || (preview === 'toggle' && previewOpen);

    return (
      <div className={containerClassName ?? 'flex flex-col gap-2 min-h-0'}>
        {toolbar && (
          <MarkdownToolbar
            onOp={runOp}
            trailing={
              preview === 'toggle' ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPreviewOpen((v) => !v)}
                  aria-pressed={previewOpen}
                  data-testid="md-toolbar-preview"
                  className="ml-1 px-2 h-7 rounded-input typo-caption text-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors focus-ring"
                >
                  {previewOpen ? t.notepad.preview_hide : t.notepad.preview_show}
                </button>
              ) : null
            }
          />
        )}
        <div className={preview === 'split' ? 'flex-1 min-h-0 grid grid-cols-2 gap-4' : 'flex-1 min-h-0 flex flex-col gap-2'}>
          {textarea}
          {showPreview && (
            <MarkdownRenderer
              content={value}
              className={previewClassName ?? 'overflow-y-auto'}
            />
          )}
        </div>
      </div>
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
