import { FolderGit2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownMiniEditor } from '@/features/shared/components/editors/MarkdownMiniEditor';

import { NOTE_PLAN_STATUSES } from './noteStatusMeta';
import { NotePlanPane } from './plan/NotePlanPane';
import { NoteHeader } from './parts/NoteHeader';
import { NoteStatusTimeline } from './parts/NoteStatusTimeline';
import { SuggestionSlot } from './parts/SuggestionSlot';
import { resultSummary } from './noteText';
import { usePlanSummary } from './useNotepad';
import type { NoteBodyProps } from './types';

/**
 * DIRECTION B — "Workbench".
 *
 * The note as a work item, not a document: editor on the left, a standing rail
 * on the right carrying the project it belongs to, where it is in its
 * lifecycle, what came back from the run, and Athena's slot. The bet is the
 * opposite of Journal's — that a note in this app is mostly READ after it has
 * been dispatched, and that the answer to "what happened to this?" should be
 * visible without a click.
 */
export default function NoteBodyWorkbench(props: NoteBodyProps) {
  const { note, onPatch, readOnly, project, suggestions } = props;
  const { t } = useTranslation();
  const summary = resultSummary(note.resultJson);
  const plan = usePlanSummary(note.id);

  // THE PLAN PANE REPLACES THE WORKBENCH, it does not sit beside it.
  //
  // A linked note in a working state is no longer a document with a result
  // rail — it is a brief beside the scope it produced, and the two layouts
  // answer different questions. The switch is on the LINK plus the status, not
  // the link alone: a note linked while still `draft` is being written and its
  // milestone has no scope to show yet, so the workbench is still the honest
  // surface for it.
  if (note.milestoneId && NOTE_PLAN_STATUSES.includes(note.status)) {
    return <NotePlanPane {...props} />;
  }

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-w-0 flex flex-col gap-4 px-8 py-6 overflow-y-auto">
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
          preview="toggle"
          rows={20}
          ariaLabel={t.notepad.editor_label}
          placeholder={t.notepad.editor_placeholder}
          testId="notepad-body-workbench"
          containerClassName="flex-1 min-h-0 flex flex-col gap-3"
          className="flex-1 min-h-[40vh] w-full resize-none rounded-card border border-primary/12 bg-secondary/15 px-4 py-3 typo-body leading-relaxed text-foreground/90 placeholder:text-foreground/60 outline-none focus:border-primary/25"
          previewClassName="flex-1 min-h-0 overflow-y-auto rounded-card border border-primary/10 bg-secondary/10 px-4 py-3"
        />
      </div>

      <aside className="w-72 flex-shrink-0 border-l border-primary/10 bg-secondary/10 px-5 py-6 flex flex-col gap-6 overflow-y-auto">
        <section className="flex flex-col gap-2">
          <h3 className="typo-caption uppercase tracking-wide text-foreground/60">
            {t.notepad.project_card_title}
          </h3>
          <div className="flex items-center gap-2 min-w-0">
            <FolderGit2 className="w-4 h-4 text-foreground/60 flex-shrink-0" aria-hidden />
            <span className="typo-body text-foreground/85 truncate">
              {project?.name ?? t.notepad.project_none}
            </span>
          </div>
          {project?.root_path && (
            <span className="typo-caption text-foreground/60 truncate">{project.root_path}</span>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="typo-caption uppercase tracking-wide text-foreground/60">
            {t.notepad.timeline_title}
          </h3>
          <NoteStatusTimeline note={note} plan={plan} />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="typo-caption uppercase tracking-wide text-foreground/60">
            {t.notepad.result_title}
          </h3>
          <p className="typo-caption text-foreground/70 whitespace-pre-wrap">
            {summary ?? t.notepad.result_empty}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="typo-caption uppercase tracking-wide text-foreground/60">
            {t.notepad.suggestions_title}
          </h3>
          <SuggestionSlot suggestions={suggestions} readOnly={readOnly} />
        </section>
      </aside>
    </div>
  );
}
