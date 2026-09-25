// RemoteNotesList — the progress notes the running device wrote for one job.
//
// Notes are persisted per job (`remote_job_notes`) and replayed on reconnect,
// so this is a plain read, re-run whenever the view's job status or state
// moves (`refreshKey`) - the running device writes a note per state change.
// While the first read is in flight and there is nothing to show, a ghost of
// three note-shaped rows sits under the section header; a refetch never hides
// notes already on screen.

import { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { RemoteJobNote } from '@/lib/bindings/RemoteJobNote';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

export function RemoteNotesList({ jobId, refreshKey }: { jobId: string; refreshKey: string }) {
  const { t } = useTranslation();
  const fetchNotes = useSystemStore((s) => s.fetchRemoteJobNotes);
  const [notes, setNotes] = useState<RemoteJobNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchNotes(jobId)
      .then((rows) => { if (!cancelled) setNotes(rows); })
      .catch(silentCatch('RemoteNotesList:fetch'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, refreshKey, fetchNotes]);

  return (
    <section aria-label={t.monitor.remote_notes_title} data-testid="remote-notes">
      <h4 className="flex items-center gap-1.5 typo-label text-primary">
        <ScrollText className="h-3.5 w-3.5" aria-hidden />
        {t.monitor.remote_notes_title}
      </h4>
      {loading && notes.length === 0 ? (
        <div className="mt-2 space-y-1.5" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-5 rounded-interactive bg-secondary/20 animate-fade-in" />)}
        </div>
      ) : notes.length === 0 ? (
        <p className="mt-2 typo-caption text-foreground">{t.monitor.remote_notes_empty}</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {notes.map((note) => (
            <li key={`${note.jobId}-${note.seq}`} className="flex items-start gap-2.5" data-testid={`remote-note-${note.seq}`}>
              <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-interactive bg-primary/10 px-1 typo-label tabular-nums text-primary">
                {note.seq}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words typo-caption text-foreground">{note.text}</span>
                <RelativeTime timestamp={note.createdAt} className="typo-label text-foreground" />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default RemoteNotesList;
