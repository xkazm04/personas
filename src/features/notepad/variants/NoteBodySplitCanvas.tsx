import { useEffect, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownMiniEditor } from '@/features/shared/components/editors/MarkdownMiniEditor';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';

import { NoteHeader } from '../parts/NoteHeader';
import { SuggestionSlot } from '../parts/SuggestionSlot';
import type { NoteBodyProps } from './types';

/** How long the preview lags the keystroke. Long enough that re-rendering the
 *  markdown tree never competes with typing, short enough to feel live. */
const PREVIEW_DEBOUNCE_MS = 180;

/**
 * DIRECTION C — "Split canvas".
 *
 * Source on the left, the rendered document on the right, always. The bet is
 * that the note's audience is not only the author — it is Athena and a fleet
 * session reading the same markdown — so seeing the RENDERED form while
 * writing is what keeps a note structured enough to be dispatched.
 *
 * Suggestions live in the PREVIEW pane rather than beside the editor: they are
 * proposed changes to the finished document, so they belong next to the
 * finished document.
 */
export default function NoteBodySplitCanvas({
  note,
  onPatch,
  readOnly,
  suggestions,
}: NoteBodyProps) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(note.bodyMd);

  // The preview trails the value rather than mirroring it: markdown parsing on
  // every keystroke is the one thing in this layout that could make typing
  // feel heavy, and nobody reads a preview mid-word.
  useEffect(() => {
    const timer = setTimeout(() => setPreview(note.bodyMd), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [note.bodyMd]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-8 pt-6 pb-4">
        <NoteHeader note={note} onRename={(title) => onPatch({ title })} readOnly={readOnly} />
        {readOnly && (
          <p className="mt-3 typo-caption text-status-warning/80 border-l-2 border-status-warning/30 pl-3">
            {t.notepad.readonly_notice}
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2 gap-px bg-primary/10">
        <div className="min-h-0 flex flex-col bg-background px-6 py-4">
          <MarkdownMiniEditor
            value={note.bodyMd}
            onChange={(bodyMd) => onPatch({ bodyMd })}
            readOnly={readOnly}
            toolbar={!readOnly}
            preview="none"
            rows={20}
            ariaLabel={t.notepad.editor_label}
            placeholder={t.notepad.editor_placeholder}
            testId="notepad-body-split"
            containerClassName="flex-1 min-h-0 flex flex-col gap-3"
            className="flex-1 min-h-0 w-full resize-none bg-transparent border-0 outline-none typo-body font-mono leading-relaxed text-foreground/85 placeholder:text-foreground/60"
            previewClassName="flex-1 min-h-0 overflow-y-auto typo-body"
          />
        </div>

        <div className="min-h-0 overflow-y-auto bg-background px-6 py-4 flex flex-col gap-5">
          <h3 className="typo-caption uppercase tracking-wide text-foreground/60">
            {t.notepad.preview_title}
          </h3>
          <MarkdownRenderer content={preview} className="typo-body text-foreground/90" />
          <SuggestionSlot suggestions={suggestions} className="mt-2" quietWhenEmpty />
        </div>
      </div>
    </div>
  );
}
