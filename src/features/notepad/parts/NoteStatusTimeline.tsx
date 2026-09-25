import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { noteLifecycleFor, noteStatusMeta } from '../noteStatusMeta';

/**
 * Which stamp carries each step's timestamp.
 *
 * TWO SOURCES, and which one a step reads from is the whole reason this is a
 * function of both the note and the plan summary. The brainstorm rail's stamps
 * are columns on `dev_notes`. The plan rail's are columns on the MILESTONE —
 * `cut_at` and `shipped_at` — which reach the pad only through
 * `notepad_list_plan_summaries`. A linked note whose summary has not loaded (or
 * whose project row is unreachable) therefore has no stamp to show, and the
 * timeline renders the step unreached rather than inventing one from the note's
 * own `updatedAt`.
 *
 * `scoped` is the honest hole. Nothing stamps the LINK moment: the note's
 * `publishedAt` is set by the brainstorm door and a linked note never passes
 * through it, and `updatedAt` moves on every keystroke, so using it would date
 * the scoping to the last time he touched a word. The step is drawn as reached
 * (the note is linked, that is evidence enough) with an em dash where the time
 * would be — see `timeline_no_stamp`.
 */
const STAMP: Record<NoteStatus, (n: DevNote, plan: NotePlanSummary | undefined) => string | null> = {
  draft: (n) => n.createdAt,
  published: (n) => n.publishedAt,
  in_progress: (n) => n.startedAt,
  completed: (n) => n.completedAt,
  archived: (n) => n.archivedAt,
  scoped: () => null,
  cut: (_n, plan) => plan?.cutAt ?? null,
  shipped: (_n, plan) => plan?.shippedAt ?? null,
};

/**
 * The lifecycle, with the stamp each step actually recorded.
 *
 * A step is REACHED when its stamp exists — not when the note's current status
 * is at-or-past it. The two differ for a note that jumped straight from
 * published to completed (the sweeper saw a `result.json` without ever seeing
 * `started.json`), and the stamps are the honest record of what happened.
 *
 * The one exception is `scoped`, which has no stamp anywhere (see `STAMP`): it
 * reads as reached from the LINK itself, and says so by showing no time rather
 * than borrowing one.
 */
export function NoteStatusTimeline({ note, plan }: { note: DevNote; plan?: NotePlanSummary }) {
  const { t } = useTranslation();
  const rail = noteLifecycleFor(note.milestoneId);

  return (
    <ol className="flex flex-col gap-2" aria-label={note.milestoneId ? t.notepad.timeline_plan_title : t.notepad.timeline_title}>
      {rail.map((step) => {
        const meta = noteStatusMeta(step);
        const at = STAMP[step](note, plan);
        // The only step whose "reached" is evidence rather than a timestamp.
        const stampless = step === 'scoped' && Boolean(note.milestoneId);
        const reached = Boolean(at) || stampless;
        const current = note.status === step;
        const Icon = meta.Icon;
        return (
          <li key={step} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border ${
                reached ? 'border-primary/30 bg-primary/10 text-foreground' : 'border-primary/10 text-foreground/60'
              }`}
            >
              <Icon className="w-3 h-3" aria-hidden />
            </span>
            <span className="min-w-0 flex flex-col">
              <span className={`typo-caption ${current ? 'text-foreground' : reached ? 'text-foreground/80' : 'text-foreground/60'}`}>
                {meta.labelKey(t)}
              </span>
              {at ? (
                <RelativeTime timestamp={at} className="typo-caption text-foreground/60" />
              ) : stampless ? (
                <span className="typo-caption text-foreground/60">{t.notepad.timeline_no_stamp}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
