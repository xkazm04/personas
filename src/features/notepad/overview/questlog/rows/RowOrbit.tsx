import { memo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { noteStatusMeta } from '../../../noteStatusMeta';
import { splitHighlight } from '../../deskModel';
import { goalFraction, journeyOf } from './journey';
import { dotsFor, type RowViewProps } from './types';

const R = 7;
const C = 2 * Math.PI * R;

/**
 * ORBIT — every state is a body, and nothing is a box or a word.
 *
 * The bet: the most compact honest mark is a circle, so make the circle carry
 * everything. A goal's status is an orb; how far its sub-goals have run is the
 * RING around that orb, not a bar somewhere else; the rail is which way the
 * ring opens. One shape, read at a glance, and the same shape at both sizes.
 *
 * The expansion puts the lifecycle on a track of bodies with the goal's own orb
 * enlarged in place, so opening a row zooms the mark rather than introducing a
 * second vocabulary. This is the design that commits hardest to the operator's
 * "symbols, dots and timeline only" — it has no prose at all, not even a count,
 * until a number genuinely beats three dots.
 */
export const RowOrbit = memo(function RowOrbit({
  note, signals, wired, rail, selected, query, matched, detail, onSelect, onOpen, onContextMenu,
}: RowViewProps) {
  const { t, tx } = useTranslation();
  const meta = noteStatusMeta(note.status);
  const waiting = signals.unread > 0;
  const searching = query.trim().length > 0;
  const hit = searching ? splitHighlight(note.title, query) : null;
  const unread = dotsFor(signals.unread);

  return (
    <div
      className="rw rw-orbit"
      data-goal-id={note.id}
      data-state={selected ? 'selected' : waiting ? 'waiting' : undefined}
      data-rail={rail}
      onContextMenu={(e) => { onSelect(); onContextMenu(e); }}
    >
      <button
        type="button"
        className={`rw-line ${meta.tone.text}${signals.onRail ? '' : ' is-off'}${searching && !matched ? ' is-dim' : ''}${searching && matched ? ' is-hit' : ''}`}
        aria-current={selected ? 'true' : undefined}
        onPointerDown={onSelect}
        onClick={onOpen}
      >
        <span className="rw-orb" aria-hidden>
          {wired ? <i className="rw-moon" /> : <i className="rw-body-dot" />}
        </span>
        <span className="rw-body">
          <span className="rw-title">
            {hit ? (<>{hit.pre}<mark>{hit.hit}</mark>{hit.post}</>) : note.title}
          </span>
          <span className="rw-marks">
            {waiting && (
              <span className="rw-mk rw-wait" title={t.notepad.desk_needs_you} aria-label={t.notepad.desk_needs_you}>
                {unread.overflow ? unread.overflow : Array.from({ length: unread.dots }, (_, i) => <i key={i} />)}
              </span>
            )}
            {signals.workingSince && <span className="rw-mk rw-work" aria-label={t.notepad.status_in_progress}><i /></span>}
            {signals.lateDays > 0 && (
              <span
                className="rw-mk rw-late"
                aria-label={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
                title={tx(t.notepad.desk_days_late, { count: signals.lateDays })}
              ><i /></span>
            )}
          </span>
        </span>
      </button>

      {detail && <OrbitDetail note={note} detail={detail} />}
    </div>
  );
});

function OrbitDetail({ note, detail }: { note: RowViewProps['note']; detail: NonNullable<RowViewProps['detail']> }) {
  const { t, tx } = useTranslation();
  const { steps, at } = journeyOf(note);
  const frac = goalFraction(detail.summary?.goalsTotal, detail.summary?.goalsDone);
  const meta = noteStatusMeta(note.status);

  return (
    <div className="rw-detail rw-orbit-detail">
      <ol className="rw-system" aria-label={t.notepad.rail_label}>
        {steps.map((step, i) => {
          const m = noteStatusMeta(step);
          const now = i === at;
          return (
            <li
              key={step}
              className={`rw-planet ${i < at ? 'is-past' : now ? 'is-now' : 'is-ahead'} ${i <= at ? m.tone.text : ''}`}
              aria-current={now ? 'step' : undefined}
              title={m.labelKey(t)}
            >
              {now && frac !== null && detail.summary ? (
                // THE RING IS THE PROGRESS. It belongs on the body the goal is
                // actually at, not beside it — one mark answering both "where"
                // and "how far".
                <svg
                  viewBox="0 0 20 20"
                  className="rw-ring"
                  role="img"
                  aria-label={tx(t.notepad.desk_goals_progress, {
                    done: detail.summary.goalsDone,
                    total: detail.summary.goalsTotal,
                  })}
                >
                  <circle cx="10" cy="10" r={R} className="rw-ring-track" />
                  <circle
                    cx="10" cy="10" r={R}
                    className="rw-ring-ink"
                    strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`}
                  />
                  <circle cx="10" cy="10" r="3" className="rw-ring-core" />
                </svg>
              ) : (
                <i className="rw-planet-dot" />
              )}
              <span className="sr-only">{m.labelKey(t)}</span>
            </li>
          );
        })}
      </ol>
      {note.dispatchTarget && (
        <i
          className={`rw-probe ${meta.tone.fill}`}
          aria-label={note.dispatchTarget === 'fleet' ? t.notepad.desk_hint_publish : t.notepad.desk_hint_goals}
          title={note.dispatchTarget === 'fleet' ? t.notepad.desk_hint_publish : t.notepad.desk_hint_goals}
        />
      )}
    </div>
  );
}
