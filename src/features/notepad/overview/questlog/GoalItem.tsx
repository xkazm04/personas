import { memo, type MouseEvent as ReactMouseEvent } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevNote } from '@/lib/bindings/DevNote';

import { splitHighlight } from '../deskModel';
import type { GoalSignals } from './goalSignals';

/** The find query's first token, lit inside a title. */
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

interface GoalItemProps {
  note: DevNote;
  signals: GoalSignals;
  selected: boolean;
  query: string;
  matched: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

/**
 * One goal inside a folded run — the dense form the last rungs of the fit
 * ladder reach for. The title is still whole and still carries every mark; only
 * the line break between goals is given up, and a middot takes its place.
 */
export const GoalItem = memo(function GoalItem({
  note, signals, selected, query, matched, onSelect, onOpen, onContextMenu,
}: GoalItemProps) {
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
      onContextMenu={(e) => { onSelect(); onContextMenu(e); }}
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

/**
 * The marks that follow a folded title — the same vocabulary the ledger row
 * uses, so collapsing a run into a sentence never changes what a mark means.
 */
function Marks({ signals }: { signals: GoalSignals }) {
  const { t, tx } = useTranslation();
  return (
    <span className="rw-marks">
      {signals.unread > 0 && (
        <span className="rw-mk rw-wait" title={t.notepad.desk_needs_you} aria-label={t.notepad.desk_needs_you}>
          {signals.unread > 3 ? signals.unread : Array.from({ length: signals.unread }, (_, i) => <i key={i} />)}
        </span>
      )}
      {signals.workingSince && (
        <span className="rw-mk rw-work" aria-label={t.notepad.status_in_progress}><i /></span>
      )}
      {signals.lateDays > 0 && (
        <span
          className="rw-mk rw-late"
          aria-label={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
          title={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
        ><i /></span>
      )}
    </span>
  );
}
