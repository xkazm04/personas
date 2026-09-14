import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Lock, Maximize2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { DeferredMarkdown } from '@/features/shared/components/editors/DeferredMarkdown';
import {
  MarkdownMiniEditor,
  type MarkdownMiniEditorHandle,
} from '@/features/shared/components/editors/MarkdownMiniEditor';
import type { DevNote } from '@/lib/bindings/DevNote';

import type { NotePatch } from '../../notepadStore';
import { canQuickWrite } from '../../noteText';

interface NoteQuickWriteProps {
  note: DevNote;
  onPatch: (patch: NotePatch) => void;
  onOpen: () => void;
  autoFocus?: boolean;
}

/** Enter / Space activate a `role="button"` region, as they would a button. */
function activateOnKey(action: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    action();
  };
}

/**
 * The card's text region.
 *
 * At rest the note is RENDERED — bold is bold, a checklist is a checklist —
 * never raw markdown. The raw text appears only while the caret is in it, and
 * only on a card that may take keystrokes: a draft of at most 100 characters
 * (`canQuickWrite`). Once editing, the textarea stays until blur even if the
 * text grows past the limit, so it is never pulled from under the hand.
 *
 * Anything longer, or no longer a draft, renders faded at the bottom edge and
 * opens the full editor on click.
 *
 * The rendered regions are `div role="button"`, not `<button>`: a button may
 * only hold phrasing content, and rendered markdown is paragraphs and lists.
 */
export function NoteQuickWrite({ note, onPatch, onOpen, autoFocus = false }: NoteQuickWriteProps) {
  const { t } = useTranslation();
  const editorRef = useRef<MarkdownMiniEditorHandle>(null);
  const [editing, setEditing] = useState(false);

  // A note created from the desk arrives with the caret in its card.
  useEffect(() => {
    if (autoFocus) setEditing(true);
  }, [autoFocus]);

  useEffect(() => {
    if (editing) editorRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <div className="flex-1 min-h-0 flex flex-col" onBlur={() => setEditing(false)}>
        <MarkdownMiniEditor
          ref={editorRef}
          value={note.bodyMd}
          onChange={(bodyMd) => onPatch({ bodyMd })}
          onCancel={() => setEditing(false)}
          rows={3}
          ariaLabel={`${t.notepad.editor_label}: ${note.title}`}
          placeholder={t.notepad.editor_placeholder}
          testId={`notepad-quickwrite-${note.id}`}
          className="flex-1 min-h-0 w-full resize-none bg-transparent typo-body text-foreground placeholder:text-foreground/50 outline-none"
        />
      </div>
    );
  }

  const rendered = <DeferredMarkdown content={note.bodyMd} variant="card" />;

  if (canQuickWrite(note)) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={activateOnKey(() => setEditing(true))}
        aria-label={`${t.notepad.editor_label}: ${note.title}`}
        data-testid={`notepad-card-body-${note.id}`}
        className="flex-1 min-h-0 overflow-hidden -mx-1.5 px-1.5 rounded-input cursor-text hover:bg-secondary/15 transition-colors focus-ring"
      >
        {note.bodyMd.trim() ? rendered : <span className="typo-body text-foreground/50">{t.notepad.editor_placeholder}</span>}
      </div>
    );
  }

  const locked = note.status !== 'draft';
  const HintIcon = locked ? Lock : Maximize2;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={activateOnKey(onOpen)}
      data-testid={`notepad-card-body-${note.id}`}
      className="group/ex flex-1 min-h-0 flex flex-col gap-2 -mx-1.5 px-1.5 rounded-input cursor-pointer focus-ring"
    >
      <div className="flex-1 min-h-0 max-h-32 overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
        {rendered}
      </div>
      <span className="flex items-center gap-1.5 typo-caption text-foreground/60 group-hover/ex:text-foreground transition-colors">
        <HintIcon className="w-3.5 h-3.5" aria-hidden />
        {locked ? t.notepad.overview_locked : t.notepad.overview_open_to_continue}
      </span>
    </div>
  );
}
