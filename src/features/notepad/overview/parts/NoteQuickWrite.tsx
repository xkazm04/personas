import { useEffect, useRef, useState } from 'react';
import { Lock, Maximize2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import {
  MarkdownMiniEditor,
  MarkdownMiniView,
  type MarkdownMiniEditorHandle,
  type MarkdownToolbarOpId,
} from '@/features/shared/components/editors/MarkdownMiniEditor';
import type { DevNote } from '@/lib/bindings/DevNote';

import type { NotePatch } from '../../notepadStore';
import { CARD_TEXT_LIMIT, canQuickWrite, cardExcerpt } from '../../noteText';
import { OVERVIEW_COPY } from '../prototypeCopy';

/** A card has room for four formatting buttons, and these are the four a
 *  hundred-character note actually uses. */
const QUICK_OPS: readonly MarkdownToolbarOpId[] = ['bold', 'italic', 'bullet', 'checklist'];

const TOOLBAR_REVEAL = {
  focus: 'opacity-0 group-focus-within/qw:opacity-100 transition-opacity',
  hover: 'opacity-0 group-hover:opacity-100 group-focus-within/qw:opacity-100 transition-opacity',
} as const;

interface NoteQuickWriteProps {
  note: DevNote;
  onPatch: (patch: NotePatch) => void;
  onOpen: () => void;
  /** `live` — a short draft is a textarea at rest. `click` — it renders as
   *  markdown at rest and becomes a textarea on click. */
  mode?: 'live' | 'click';
  toolbarReveal?: keyof typeof TOOLBAR_REVEAL;
  autoFocus?: boolean;
}

/**
 * The card's text region, and the one rule the overview is built on: a card is
 * where you write a note only while it is a short draft. Anything longer — or
 * no longer a draft — renders as an excerpt that opens the editor.
 *
 * The rule is LATCHED while the caret is inside: typing past the limit does not
 * yank the textarea out from under the hand. It takes effect on blur.
 */
export function NoteQuickWrite({
  note,
  onPatch,
  onOpen,
  mode = 'live',
  toolbarReveal = 'focus',
  autoFocus = false,
}: NoteQuickWriteProps) {
  const { t } = useTranslation();
  const editorRef = useRef<MarkdownMiniEditorHandle>(null);
  const [holding, setHolding] = useState(false);
  const [armed, setArmed] = useState(false);

  const writable = holding || canQuickWrite(note);
  const editing = writable && (mode === 'live' || armed || holding);

  useEffect(() => {
    if (editing && (autoFocus || armed)) editorRef.current?.focus();
  }, [editing, autoFocus, armed]);

  if (editing) {
    return (
      <div
        className="group/qw flex-1 min-h-0 flex flex-col gap-1"
        onFocus={() => setHolding(true)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setHolding(false);
          setArmed(false);
        }}
      >
        <MarkdownMiniEditor
          ref={editorRef}
          value={note.bodyMd}
          onChange={(bodyMd) => onPatch({ bodyMd })}
          onCancel={() => (document.activeElement as HTMLElement | null)?.blur()}
          toolbar
          toolbarOps={QUICK_OPS}
          toolbarClassName={`-ml-1.5 ${TOOLBAR_REVEAL[toolbarReveal]}`}
          rows={3}
          ariaLabel={`${t.notepad.editor_label}: ${note.title}`}
          placeholder={t.notepad.editor_placeholder}
          testId={`notepad-quickwrite-${note.id}`}
          containerClassName="flex-1 min-h-0 flex flex-col gap-1"
          className="flex-1 min-h-0 w-full resize-none bg-transparent typo-body text-foreground placeholder:text-foreground/50 outline-none"
        />
        <span
          className={`typo-caption tabular-nums opacity-0 group-focus-within/qw:opacity-100 transition-opacity ${
            note.bodyMd.length > CARD_TEXT_LIMIT ? 'text-status-warning' : 'text-foreground/50'
          }`}
        >
          {note.bodyMd.length > CARD_TEXT_LIMIT ? OVERVIEW_COPY.over_limit : `${note.bodyMd.length}/${CARD_TEXT_LIMIT}`}
        </span>
      </div>
    );
  }

  if (writable) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="flex-1 min-h-0 overflow-hidden text-left rounded-input focus-ring hover:bg-secondary/20 transition-colors -mx-1.5 px-1.5"
      >
        {note.bodyMd.trim() ? (
          <MarkdownMiniView content={note.bodyMd} className="typo-body text-foreground" />
        ) : (
          <span className="typo-body text-foreground/50">{OVERVIEW_COPY.write_prompt}</span>
        )}
      </button>
    );
  }

  const excerpt = cardExcerpt(note.bodyMd);
  const locked = note.status !== 'draft';
  const HintIcon = locked ? Lock : Maximize2;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex-1 min-h-0 flex flex-col gap-2 text-left rounded-input focus-ring -mx-1.5 px-1.5 group/ex"
    >
      <span className="typo-body text-foreground/85 line-clamp-4">{excerpt.text}</span>
      <span className="mt-auto flex items-center gap-1.5 typo-caption text-foreground/55 group-hover/ex:text-foreground transition-colors">
        <HintIcon className="w-3.5 h-3.5" aria-hidden />
        {locked ? OVERVIEW_COPY.locked : OVERVIEW_COPY.open_to_continue}
      </span>
    </button>
  );
}
