import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { NOTE_LIFECYCLE, noteStatusMeta } from '../noteStatusMeta';

/** Which stamp column carries each lifecycle step's timestamp. */
const STAMP: Record<NoteStatus, (n: DevNote) => string | null> = {
  draft: (n) => n.createdAt,
  published: (n) => n.publishedAt,
  in_progress: (n) => n.startedAt,
  completed: (n) => n.completedAt,
  archived: (n) => n.archivedAt,
};

/**
 * draft → published → in progress → completed, with the stamp each step
 * actually recorded.
 *
 * A step is REACHED when its stamp exists — not when the note's current status
 * is at-or-past it. The two differ for a note that jumped straight from
 * published to completed (the sweeper saw a `result.json` without ever seeing
 * `started.json`), and the stamps are the honest record of what happened.
 */
export function NoteStatusTimeline({ note }: { note: DevNote }) {
  const { t } = useTranslation();

  return (
    <ol className="flex flex-col gap-2" aria-label={t.notepad.timeline_title}>
      {NOTE_LIFECYCLE.map((step) => {
        const meta = noteStatusMeta(step);
        const at = STAMP[step](note);
        const current = note.status === step;
        const Icon = meta.Icon;
        return (
          <li key={step} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border ${
                at ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-primary/10 text-foreground/60'
              }`}
            >
              <Icon className="w-3 h-3" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col">
              <span className={`typo-caption ${current ? 'text-foreground font-medium' : at ? 'text-foreground/80' : 'text-foreground/60'}`}>
                {meta.labelKey(t)}
              </span>
              {at && <RelativeTime timestamp={at} className="typo-caption text-foreground/60" />}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
