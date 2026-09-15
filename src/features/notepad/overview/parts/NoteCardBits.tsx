import { FolderGit2, Gauge, Maximize2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { Badge } from '@/features/shared/components/display/Badge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NotePlanSummary } from '@/lib/bindings/NotePlanSummary';

import type { NoteSaveState } from '../../notepadStore';
import { noteStatusMeta } from '../../noteStatusMeta';
import { CARD_TEXT_LIMIT, visibleLength } from '../../noteText';
import { SaveDot } from '../../parts/SaveDot';
import type { DeskForecast } from '../deskForecast';

/** The project a note belongs to — its name, never a raw id. */
export function ProjectLabel({
  projectId,
  projects,
  className = '',
}: {
  projectId: string | null;
  projects: readonly DevProject[];
  className?: string;
}) {
  const { t } = useTranslation();
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined;
  return (
    <span className={`flex items-center gap-1.5 min-w-0 typo-caption ${project ? 'text-foreground/75' : 'text-foreground/50'} ${className}`}>
      <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
      <span className="truncate">{project?.name ?? t.notepad.project_none}</span>
    </span>
  );
}

/**
 * The goals bar — the milestone's `goalsDone / goalsTotal` as a 2px rule under
 * the title.
 *
 * HIDDEN at `goalsTotal === 0`, which is not the same as 0%: a milestone with no
 * goals yet has nothing to be a fraction of, and an empty bar would read as "no
 * progress" rather than "nothing decomposed". The fill takes the note's own
 * status tone, so the card carries one colour rather than two.
 */
export function GoalsBar({ note, summary }: { note: DevNote; summary: NotePlanSummary }) {
  const { t, tx } = useTranslation();
  if (summary.goalsTotal <= 0) return null;
  const done = Math.min(summary.goalsDone, summary.goalsTotal);
  const pct = Math.round((done / summary.goalsTotal) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={summary.goalsTotal}
      aria-valuenow={done}
      aria-label={tx(t.notepad.desk_goals_progress, { done, total: summary.goalsTotal })}
      data-testid={`notepad-card-goals-${note.id}`}
      className="h-0.5 w-full rounded-full bg-secondary/50 overflow-hidden"
    >
      {/* Width is the DATA, so it is the one thing that cannot be a token. */}
      <div className={`h-full ${noteStatusMeta(note.status).tone.fill}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * The milestone's stamp as a chip — "Cut · 3 days" / "Shipped · 2 hr".
 *
 * REPLACES the plain status badge on a linked card rather than sitting beside
 * it: the status badge for a `cut` note already reads "Cut", and the same word
 * twice in a ~330px row spends the card's only horizontal budget on no
 * information. This chip is the same word plus the thing the status badge never
 * had — WHEN. Returns null when the summary carries neither stamp, and the
 * caller falls back to the ordinary status badge.
 */
export function PlanStampBadge({ note, summary }: { note: DevNote; summary: NotePlanSummary }) {
  const { t } = useTranslation();
  const shipped = Boolean(summary.shippedAt);
  const stamp = shipped ? summary.shippedAt : summary.cutAt;
  if (!stamp) return null;
  const meta = noteStatusMeta(shipped ? 'shipped' : 'cut');
  return (
    <Badge variant={meta.badgeVariant} size="sm" data-testid={`notepad-card-stamp-${note.id}`}>
      <meta.Icon className="w-3 h-3" aria-hidden />
      {shipped ? t.notepad.status_shipped : t.notepad.status_cut}
      <span aria-hidden>·</span>
      <RelativeTime timestamp={stamp} format="elapsed" />
    </Badge>
  );
}

/**
 * The card's ONE metadata row: last touched · save state · characters used ·
 * open. The count shows only on a draft — the one state whose text can still
 * change — counts VISIBLE characters (markers are formatting, not text), and
 * turns amber past the card limit, which is also the reason such a card shows
 * a faded rendering instead of an editable one.
 *
 * A linked card gains ONE line above it: the project's cycle-time forecast for
 * this milestone. It is a whole line rather than another chip in the row because
 * it is the only thing on the card that is a PREDICTION, and a prediction that
 * has to be told apart from a measurement by its position in a dense row will
 * not be.
 */
export function NoteCardFooter({
  note,
  saveState,
  forecast,
  onOpen,
}: {
  note: DevNote;
  saveState: NoteSaveState;
  /** Absent for an unlinked note, a shipped one, and a project below the
   *  evidence bar — see `deskForecast.ts`. */
  forecast?: DeskForecast;
  onOpen: () => void;
}) {
  const { t, tx } = useTranslation();
  const length = visibleLength(note.bodyMd);
  return (
    <footer className="flex flex-col gap-1">
      {forecast && (
        <p
          className="flex items-center gap-1.5 min-w-0 typo-caption text-foreground/85"
          data-testid={`notepad-card-forecast-${note.id}`}
        >
          <Gauge className="w-3 h-3 shrink-0 text-status-info" aria-hidden />
          <span className="truncate tabular-nums">
            {tx(
              forecast.basis === 'cut' ? t.notepad.desk_forecast_cut : t.notepad.desk_forecast_today,
              { date: forecast.date },
            )}
          </span>
        </p>
      )}
      <div className="flex items-center gap-2 typo-caption text-foreground/60">
        <RelativeTime timestamp={note.updatedAt} format="elapsed" />
        <SaveDot state={saveState} />
        {note.status === 'draft' && (
          <>
            <span aria-hidden>·</span>
            <span
              className={`tabular-nums ${length > CARD_TEXT_LIMIT ? 'text-status-warning' : ''}`}
              data-testid={`notepad-card-count-${note.id}`}
            >
              {length}/{CARD_TEXT_LIMIT}
            </span>
          </>
        )}
        <Tooltip content={t.notepad.overview_open}>
          <button
            type="button"
            onClick={onOpen}
            aria-label={t.notepad.overview_open}
            data-testid={`notepad-card-open-${note.id}`}
            className="ml-auto w-7 h-7 rounded-input flex items-center justify-center text-foreground/60 hover:text-foreground hover:bg-secondary/50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-ring"
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        </Tooltip>
      </div>
    </footer>
  );
}

/** Ghost grid under the overview's chrome while the first fetch is in flight. */
export function OverviewGhost() {
  return (
    <div className="grid grid-cols-4 gap-4" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-52 rounded-card bg-secondary/20" />
      ))}
    </div>
  );
}
