import { useEffect, useRef, useState } from 'react';
import { Lock, Maximize2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import {
  MarkdownMiniEditor,
  type MarkdownMiniEditorHandle,
} from '@/features/shared/components/editors/MarkdownMiniEditor';
import type { DevNote } from '@/lib/bindings/DevNote';

import type { NotePatch } from '../../notepadStore';
import { canQuickWrite, cardExcerpt } from '../../noteText';

interface NoteQuickWriteProps {
  note: DevNote;
  onPatch: (patch: NotePatch) => void;
  onOpen: () => void;
  autoFocus?: boolean;
}

/**
 * The card's text region, and the one rule the overview is built on: a card is
 * where you write a note only while it is a short draft. Anything longer — or
 * no longer a draft — renders as an excerpt that opens the editor.
 *
 * The rule is LATCHED while the caret is inside: typing past the limit does not
 * yank the textarea out from under the hand. It takes effect on blur.
 *
 * There is no formatting toolbar: a card's height belongs to the note, and the
 * editor's shortcuts (Ctrl/Cmd+B, I, 1/2/3, list continuation on Enter) work
 * in the bare textarea exactly as they do in the full editor.
 */
export function NoteQuickWrite({ note, onPatch, onOpen, autoFocus = false }: NoteQuickWriteProps) {
  const { t } = useTranslation();
  const editorRef = useRef<MarkdownMiniEditorHandle>(null);
  const [holding, setHolding] = useState(false);

  const writable = holding || canQuickWrite(note);

  useEffect(() => {
    if (writable && autoFocus) editorRef.current?.focus();
  }, [writable, autoFocus]);

  if (writable) {
    return (
      <div
        className="flex-1 min-h-0 flex flex-col"
        onFocus={() => setHolding(true)}
        onBlur={() => setHolding(false)}
      >
        <MarkdownMiniEditor
          ref={editorRef}
          value={note.bodyMd}
          onChange={(bodyMd) => onPatch({ bodyMd })}
          onCancel={() => (document.activeElement as HTMLElement | null)?.blur()}
          rows={3}
          ariaLabel={`${t.notepad.editor_label}: ${note.title}`}
          placeholder={t.notepad.editor_placeholder}
          testId={`notepad-quickwrite-${note.id}`}
          className="flex-1 min-h-0 w-full resize-none bg-transparent typo-body text-foreground placeholder:text-foreground/50 outline-none"
        />
      </div>
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
      <span className="typo-body text-foreground/85 line-clamp-5">{excerpt.text}</span>
      <span className="mt-auto flex items-center gap-1.5 typo-caption text-foreground/60 group-hover/ex:text-foreground transition-colors">
        <HintIcon className="w-3.5 h-3.5" aria-hidden />
        {locked ? t.notepad.overview_locked : t.notepad.overview_open_to_continue}
      </span>
    </button>
  );
}
