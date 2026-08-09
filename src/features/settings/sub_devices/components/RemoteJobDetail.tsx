/**
 * The expanded record under a selected remote-job row: the progress notes in
 * the order the running device emitted them, then the final summary (or the
 * reason the peer refused).
 *
 * Notes are numbered by `seq`, which is 1-based, monotonic and gap-free per
 * job — so a visible gap means a note was lost in transit, not that the peer
 * skipped one. Showing the number is what makes that legible.
 */
import { CircleAlert, ScrollText } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { RemoteJob } from '@/lib/bindings/RemoteJob';
import type { RemoteJobNote } from '@/lib/bindings/RemoteJobNote';
import { isTerminalRemoteJobStatus } from '@/lib/network/remoteJobHistory';

interface RemoteJobDetailProps {
  job: RemoteJob;
  notes: RemoteJobNote[];
  notesLoading: boolean;
  notesError: boolean;
}

export function RemoteJobDetail({ job, notes, notesLoading, notesError }: RemoteJobDetailProps) {
  const { t } = useTranslation();
  const st = t.sharing;
  const settled = isTerminalRemoteJobStatus(job.status);

  return (
    <div
      data-testid={`remote-job-detail-${job.id}`}
      className="mt-3 rounded-card border border-primary/15 bg-secondary/20 p-3.5 space-y-3.5"
    >
      <p className="typo-body text-foreground/90 leading-relaxed" data-testid="remote-job-detail-instruction">
        {job.instruction}
      </p>

      <section aria-label={st.job_notes_title}>
        <h4 className="typo-label font-medium text-primary flex items-center gap-1.5">
          <ScrollText className="w-3.5 h-3.5" aria-hidden />
          {st.job_notes_title}
        </h4>

        {notesLoading && notes.length === 0 ? (
          <p
            role="status"
            className="mt-2 typo-caption text-foreground"
            data-testid="remote-job-notes-loading"
          >
            {st.job_notes_loading}
          </p>
        ) : notesError ? (
          <p className="mt-2 typo-caption text-status-warning" data-testid="remote-job-notes-failed">
            {st.job_notes_failed}
          </p>
        ) : notes.length === 0 ? (
          <p className="mt-2 typo-caption text-foreground" data-testid="remote-job-notes-empty">
            {st.job_notes_empty}
          </p>
        ) : (
          <ol className="mt-2 space-y-1.5" data-testid="remote-job-notes">
            {notes.map((note) => (
              <li
                key={`${note.jobId}-${note.seq}`}
                data-testid={`remote-job-note-${note.seq}`}
                className="flex items-start gap-2.5"
              >
                <span className="mt-0.5 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-interactive bg-primary/10 text-primary typo-label font-medium tabular-nums">
                  {note.seq}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="typo-caption text-foreground/90 leading-relaxed block break-words">
                    {note.text}
                  </span>
                  <RelativeTime timestamp={note.createdAt} className="typo-label text-foreground" />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label={job.refusalReason ? st.job_refusal_title : st.job_summary_title}>
        <h4 className="typo-label font-medium text-primary">
          {job.refusalReason ? st.job_refusal_title : st.job_summary_title}
        </h4>
        {job.refusalReason ? (
          <p
            data-testid="remote-job-refusal"
            className="mt-1.5 flex items-start gap-2 typo-caption text-status-warning leading-relaxed"
          >
            <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            <span className="break-words">{job.refusalReason}</span>
          </p>
        ) : job.summary ? (
          <p
            data-testid="remote-job-summary"
            className="mt-1.5 typo-caption text-foreground/90 leading-relaxed break-words whitespace-pre-wrap"
          >
            {job.summary}
          </p>
        ) : (
          <p data-testid="remote-job-summary-pending" className="mt-1.5 typo-caption text-foreground">
            {settled ? st.job_notes_empty : st.job_summary_pending}
          </p>
        )}
      </section>
    </div>
  );
}
