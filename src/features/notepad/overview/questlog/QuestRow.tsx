import { memo } from 'react';
import { Clock, MessageSquare } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevNote } from '@/lib/bindings/DevNote';

import { noteStatusMeta } from '../../noteStatusMeta';
import { splitHighlight } from '../deskModel';
import type { NoteRail } from './questlogModel';

/** Everything a row needs to know about one goal that is not on the goal itself.
 *  Assembled once for the whole desk by `QuestLogOverview`, never per row. */
export interface GoalSignals {
  /** Unread entries from an agent or Athena. The operator's own comments are
   *  born read, so any unread count means somebody is waiting on a reading. */
  unread: number;
  /** An agent or Athena is on this goal right now; ISO start of the work. */
  workingSince: string | null;
  /** Whole days past the milestone's target date, or 0. */
  lateDays: number;
  /** On the rail the operator is currently looking down. Off-rail rows dim in
   *  place — the rail is a lens, not a filter. */
  onRail: boolean;
}

export const NO_SIGNALS: GoalSignals = Object.freeze({ unread: 0, workingSince: null, lateDays: 0, onRail: true });

/** The marks that follow a title. Deliberately the same set in both the line
 *  form and the dense sentence form, so folding a run never drops a reading. */
const Marks = memo(function Marks({ signals }: { signals: GoalSignals }) {
  const { t, tx } = useTranslation();
  return (
    <>
      {signals.unread > 0 && (
        <span className="ql-tag text-brand-rose">{t.notepad.desk_needs_you}</span>
      )}
      {signals.workingSince && (
        <span className="ql-tag text-status-pending">
          <RelativeTime timestamp={signals.workingSince} format="elapsed" showTooltip={false} />
        </span>
      )}
      {signals.lateDays > 0 && (
        <span className="ql-tag text-status-error">
          <Clock aria-hidden />
          {tx(t.notepad.desk_days_late, { count: signals.lateDays })}
        </span>
      )}
      {signals.unread > 0 && (
        <span className="ql-tag text-foreground/85">
          <MessageSquare aria-hidden />
          {signals.unread}
        </span>
      )}
    </>
  );
});

/** The first token of the find query, lit inside the title. */
function Title({ title, query }: { title: string; query: string }) {
  const split = query.trim() ? splitHighlight(title, query) : null;
  if (!split) return <>{title}</>;
  return (
    <>
      {split.pre}
      <mark className="bg-primary/30 text-foreground rounded-[2px] px-[1px]">{split.hit}</mark>
      {split.post}
    </>
  );
}

interface QuestRowProps {
  note: DevNote;
  signals: GoalSignals;
  /** True for every goal after the first in a run of one status: it draws a
   *  wire instead of repeating the glyph. */
  wired: boolean;
  rail: NoteRail;
  selected: boolean;
  query: string;
  matched: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

/**
 * One goal, one line.
 *
 * Three tracks: a mark gutter that carries the single most urgent signal, a
 * glyph column that either names the status or wires this goal to the one above
 * it, and the title — **whole, never clipped, never behind a hover**. That last
 * rule is the constraint the whole layout is built around; if a title cannot
 * fit, the fit ladder changes the type and then the form, and when it runs out
 * the column scrolls and says what is below. It never shortens a title.
 */
export const QuestRow = memo(function QuestRow({
  note, signals, wired, rail, selected, query, matched, onSelect, onOpen,
}: QuestRowProps) {
  const { t } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const waiting = signals.unread > 0;
  const searching = query.trim().length > 0;

  const cls = [
    'ql-row',
    `is-rail-${rail}`,
    meta.tone.text,
    waiting ? 'is-waiting' : '',
    signals.onRail ? '' : 'is-off',
    selected ? 'is-selected' : '',
    searching && matched ? 'is-hit' : '',
    searching && !matched ? 'is-dim' : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      type="button"
      className={cls}
      data-goal-id={note.id}
      aria-current={selected ? 'true' : undefined}
      onPointerDown={onSelect}
      onClick={onOpen}
    >
      <span className="ql-mark">
        {waiting ? (
          <span className="ql-bang" aria-label={t.notepad.desk_needs_you}>!</span>
        ) : signals.workingSince ? (
          <span className="w-1.5 h-1.5 rounded-full bg-status-pending" aria-hidden />
        ) : signals.lateDays > 0 ? (
          <Clock className="w-3 h-3 text-status-error" aria-hidden />
        ) : null}
      </span>
      <span className="ql-glyph">
        {wired ? (
          <>
            <i className="ql-wire" aria-hidden />
            <span className="sr-only">{meta.labelKey(t)}</span>
          </>
        ) : (
          <>
            <meta.Icon aria-hidden />
            <span className="sr-only">{meta.labelKey(t)}</span>
          </>
        )}
      </span>
      <span className="ql-title">
        <Title title={note.title} query={query} />
        <Marks signals={signals} />
      </span>
    </button>
  );
});

interface QuestItemProps {
  note: DevNote;
  signals: GoalSignals;
  selected: boolean;
  query: string;
  matched: boolean;
  onSelect: () => void;
  onOpen: () => void;
}

/**
 * One goal inside a folded run — the dense form the last rungs of the fit
 * ladder reach for. The title is still whole and still carries every mark; only
 * the line break between goals is given up, and a middot takes its place.
 */
export const QuestItem = memo(function QuestItem({
  note, signals, selected, query, matched, onSelect, onOpen,
}: QuestItemProps) {
  const { t } = useTranslation();
  const waiting = signals.unread > 0;
  const searching = query.trim().length > 0;

  const cls = [
    'ql-item',
    waiting ? 'is-waiting' : '',
    signals.onRail ? '' : 'is-off',
    selected ? 'is-selected' : '',
    searching && matched ? 'is-hit' : '',
    searching && !matched ? 'is-dim' : '',
  ].filter(Boolean).join(' ');

  return (
    // A span, not a button: this sits INSIDE a flowing sentence and has to wrap
    // across lines with `box-decoration-break: clone`, which a button cannot do.
    // It therefore carries the keyboard activation a button would have given it.
    <span
      className={cls}
      data-goal-id={note.id}
      role="button"
      tabIndex={-1}
      onPointerDown={onSelect}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect();
        onOpen();
      }}
    >
      {waiting && <span className="ql-bang" aria-label={t.notepad.desk_needs_you}>!</span>}
      <Title title={note.title} query={query} />
      <Marks signals={signals} />
    </span>
  );
});
