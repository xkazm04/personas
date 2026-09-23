import { memo, Fragment, type MouseEvent as ReactMouseEvent } from 'react';
import { PauseCircle } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { noteStatusMeta } from '../../noteStatusMeta';
import { DESK_KEY, Keycap } from '../parts/Keycap';
import { groupRuns, type QuestZone as Zone } from './questlogModel';
import { QuestItem, type GoalSignals, type RowDetail, NO_SIGNALS } from './QuestRow';
import type { RowView } from './rows';

interface QuestZoneProps {
  zone: Zone;
  signals: Readonly<Record<string, GoalSignals>>;
  /** `lines` gives every goal a row; `runs` folds a status run into one
   *  sentence. Chosen by the fit ladder, identical for every zone so the desk
   *  reads as one document. */
  mode: 'lines' | 'runs';
  current: boolean;
  selectedGoalId: string | null;
  query: string;
  matches: ReadonlySet<string>;
  /** Builds the second row for one goal, or returns undefined. Only ever
   *  non-undefined for the goal the cursor is on and the operator expanded. */
  detailFor: (noteId: string) => RowDetail | undefined;
  /** The row design in force. Chosen once by the host, identical for every
   *  zone - a page where some rows are ledger lines and others are orbs reads
   *  as two documents. */
  RowView: RowView;
  onContextGoal: (noteId: string, e: ReactMouseEvent) => void;
  onFocusZone: () => void;
  onSelectGoal: (id: string) => void;
  onOpenGoal: (id: string) => void;
}

/**
 * One project's seat on the desk.
 *
 * The head is the project's name and nothing decorative: its live count, a rose
 * flag when something inside is waiting on the operator, and a working tally.
 * The body is the project's goals in rail order — plan rail first, then the
 * shared draft state, then brainstorm — with a hairline where the plan rail
 * hands over.
 *
 * A zone is exactly as tall as its goals are many. Nothing is weighted, nothing
 * is scaled: the surface spends its height on content and the eye reads the
 * relative size of the work directly.
 */
export const QuestZone = memo(function QuestZone({
  zone, signals, mode, current, selectedGoalId, query, matches, detailFor, onContextGoal, RowView,
  onFocusZone, onSelectGoal, onOpenGoal,
}: QuestZoneProps) {
  const { t } = useTranslation();

  // A shipped goal never reaches the desk: it is the record of a milestone that
  // landed, and it belongs in the archive drawer beside the archived ones. Rust
  // already keeps it out of the cap, so the desk and the cap agree (deskFilter.ts).
  const visible = zone.goals.filter((n) => n.status !== 'shipped');
  const waiting = visible.filter((n) => (signals[n.id] ?? NO_SIGNALS).unread > 0).length;
  const working = visible.filter((n) => (signals[n.id] ?? NO_SIGNALS).workingSince).length;

  const runs = groupRuns(visible);

  return (
    <section
      className={`ql-zone${current ? ' is-current' : ''}${zone.none ? ' is-none' : ''}`}
      data-zone-id={zone.id}
      // Read back off the DOM by `QuestBelow`, which has to name what is under a
      // scrolling column's fold and only knows the zones by their elements.
      data-zone-name={zone.name}
      data-zone-count={visible.length}
      data-zone-waiting={waiting > 0 ? '1' : '0'}
    >
      <button type="button" className="ql-zone-head focus-ring" onClick={onFocusZone}>
        <h3>{zone.name}</h3>
        <span className="typo-label text-foreground/85 tabular-nums whitespace-nowrap">{visible.length}</span>
        {waiting > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 rounded-interactive typo-label text-brand-rose bg-brand-rose/15 self-center">
            <PauseCircle className="w-3 h-3" aria-hidden />
            {waiting}
          </span>
        )}
        {working > 0 && (
          <span className="inline-flex items-center gap-1 typo-label text-status-pending self-center">
            <span className="w-1.5 h-1.5 rounded-full bg-status-pending" aria-hidden />
            {working}
          </span>
        )}
        {current && (
          <span className="ml-auto inline-flex items-center gap-1 typo-label text-foreground/85 self-center">
            <Keycap>{DESK_KEY.enterGlyph}</Keycap>
            {t.notepad.overview_open}
          </span>
        )}
      </button>

      {visible.length === 0 ? (
        <p className="ml-6 my-0 typo-caption italic text-foreground/85 leading-relaxed">
          {t.notepad.desk_zone_none_live}
        </p>
      ) : mode === 'runs' ? (
        runs.map((run) => (
          <Fragment key={run.goals[0]!.id}>
            {run.breakBefore && <div className="ql-split" aria-hidden />}
            {run.goals.length === 1 ? (
              <RowView
                note={run.goals[0]!}
                signals={signals[run.goals[0]!.id] ?? NO_SIGNALS}
                wired={false}
                rail={run.rail}
                selected={selectedGoalId === run.goals[0]!.id}
                query={query}
                matched={matches.has(run.goals[0]!.id)}
                detail={detailFor(run.goals[0]!.id)}
                onSelect={() => onSelectGoal(run.goals[0]!.id)}
                onOpen={() => onOpenGoal(run.goals[0]!.id)}
                onContextMenu={(e) => onContextGoal(run.goals[0]!.id, e)}
              />
            ) : (
              <div className={`ql-row is-rail-${run.rail} ${runToneClass(run.status)}`}>
                <span className="ql-mark" />
                <span className="ql-glyph"><RunGlyph status={run.status} /></span>
                <span className="ql-title">
                  {run.goals.map((note, i) => (
                    <Fragment key={note.id}>
                      {i > 0 && <i className="ql-sep" aria-hidden>·</i>}
                      <QuestItem
                        note={note}
                        signals={signals[note.id] ?? NO_SIGNALS}
                        selected={selectedGoalId === note.id}
                        query={query}
                        matched={matches.has(note.id)}
                        onSelect={() => onSelectGoal(note.id)}
                        onOpen={() => onOpenGoal(note.id)}
                        onContextMenu={(e) => onContextGoal(note.id, e)}
                      />
                    </Fragment>
                  ))}
                </span>
              </div>
            )}
          </Fragment>
        ))
      ) : (
        runs.map((run) => (
          <Fragment key={run.goals[0]!.id}>
            {run.breakBefore && <div className="ql-split" aria-hidden />}
            {run.goals.map((note, i) => (
              <RowView
                key={note.id}
                note={note}
                signals={signals[note.id] ?? NO_SIGNALS}
                wired={i > 0}
                rail={run.rail}
                selected={selectedGoalId === note.id}
                query={query}
                matched={matches.has(note.id)}
                detail={detailFor(note.id)}
                onSelect={() => onSelectGoal(note.id)}
                onOpen={() => onOpenGoal(note.id)}
                onContextMenu={(e) => onContextGoal(note.id, e)}
              />
            ))}
          </Fragment>
        ))
      )}
    </section>
  );
});

/** The tone the whole folded run wears — the wire under it reads `currentColor`. */
function runToneClass(status: NoteStatus): string {
  return noteStatusMeta(status).tone.text;
}

function RunGlyph({ status }: { status: NoteStatus }) {
  const { t } = useTranslation();
  const meta = noteStatusMeta(status);
  return (
    <>
      <meta.Icon aria-hidden />
      <span className="sr-only">{meta.labelKey(t)}</span>
    </>
  );
}
