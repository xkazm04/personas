import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownMiniEditor } from '@/features/shared/components/editors/MarkdownMiniEditor';

import { NoteHeader } from '../parts/NoteHeader';
import { SuggestionSlot } from '../parts/SuggestionSlot';
import type { NoteBodyProps } from './types';

/**
 * DIRECTION A — "Journal".
 *
 * One centred document column and nothing beside it. No rail, no split, no
 * chrome competing with the text: the bet is that a notepad's job is to get
 * out of the way, and that everything a workbench would show in a sidebar is
 * either already in the dispatch bar or is not needed while writing.
 *
 * Suggestions become MARGIN NOTES — an `<aside>` in the outer gutter, at the
 * same vertical rhythm as the prose, the way an editor's pencil marks sit
 * beside a manuscript rather than inside it.
 */
export default function NoteBodyJournal({
  note,
  onPatch,
  readOnly,
  suggestions,
}: NoteBodyProps) {
  const { t } = useTranslation();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-8 py-10 flex gap-8">
        <div className="flex-1 min-w-0 max-w-2xl mx-auto flex flex-col gap-6">
          <NoteHeader note={note} onRename={(title) => onPatch({ title })} readOnly={readOnly} />

          {readOnly && (
            <p className="typo-caption text-status-warning/80 border-l-2 border-status-warning/30 pl-3">
              {t.notepad.readonly_notice}
            </p>
          )}

          <MarkdownMiniEditor
            value={note.bodyMd}
            onChange={(bodyMd) => onPatch({ bodyMd })}
            readOnly={readOnly}
            toolbar={!readOnly}
            preview="none"
            rows={24}
            ariaLabel={t.notepad.editor_label}
            placeholder={t.notepad.editor_placeholder}
            testId="notepad-body-journal"
            containerClassName="flex flex-col gap-3 min-h-0"
            className="w-full min-h-[60vh] resize-none bg-transparent border-0 outline-none typo-body leading-[1.75] text-foreground/90 placeholder:text-foreground/60"
            previewClassName="typo-body leading-[1.75] text-foreground/90"
          />
        </div>

        {/* The margin. Empty by design until WP3 fills it — the column keeps
            its width so the prose does not reflow when the first note lands. */}
        <aside className="hidden xl:block w-56 flex-shrink-0 pt-24">
          <SuggestionSlot suggestions={suggestions} readOnly={readOnly} quietWhenEmpty />
        </aside>
      </div>
    </div>
  );
}
