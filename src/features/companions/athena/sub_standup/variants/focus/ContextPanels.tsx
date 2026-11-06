import { Button } from '@/features/shared/components/buttons';
import { Figure, Meta, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { clockLabel, hourTicks, pos } from '../../model/timeAxis';
import type { RowView, StandupView } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { FOCUS_COPY as F } from './copy';
import { atPos, blockMinutes } from './model';

const SHOWN = 5;

/** Today: this line's away acts as words on a short vertical timeline, newest first; the rest live in the dossier. */
export function TodayPanel({ view, row, onDossier }: { view: StandupView; row: RowView; onDossier: () => void }) {
  const { tx } = useTranslation();
  const armed = view.life !== 'decide' && row.nightMarks.length > 0;
  const marks = [...(armed ? row.nightMarks : row.pastMarks)].sort((x, y) => y.at - x.at);
  const more = marks.length - SHOWN;
  const moved = row.moved > 0 ? tx(F.today_moved, { n: row.moved }) : null;
  return (
    <Section level={2} title={armed ? F.since_armed : F.today} count={marks.length || undefined} meta={moved} className="sf-panel">
      {marks.length === 0 ? <p className="typo-caption sf-panel__empty">{F.today_none}</p> : (
        <ol className="sf-log">
          {marks.slice(0, SHOWN).map((m) => (
            <li key={m.id}>
              <span className="typo-data k-regular sf-log__t">{clockLabel(m.at)}</span>
              <svg className="sf-log__k" viewBox="-6 -6 12 12" aria-hidden="true"><circle className={`su-k su-k--${m.kind}`} r="4" /></svg>
              <span className="typo-body text-foreground">{m.summary}</span>
            </li>
          ))}
        </ol>
      )}
      {more > 0 && <Button variant="ghost" size="sm" onClick={onDossier} className="sf-panel__more">{tx(F.more_in_dossier, { n: more })}</Button>}
    </Section>
  );
}

/** Tonight: the machine's lanes with this line's blocks lit and the others faint, on the night's hour axis. */
export function TonightPanel({ view, row }: { view: StandupView; row: RowView }) {
  const { t, tx } = useTranslation();
  const m = view.machine;
  const mine = new Set(row.blocks.map((b) => b.id));
  const laneH = 1 / Math.max(1, m.lanes);
  const span = view.night.to - view.night.from;
  const now = view.status === 'armed' ? pos(view.nowMs, view.night) : null;
  const runs = row.blocks.map((b) => `${clockLabel(atPos(b.start, view.night))}-${clockLabel(atPos(b.end, view.night))}`);
  const meta = row.blocks.length > 0 ? tx(F.tonight_runs, { n: row.blocks.length, min: blockMinutes(row.blocks, span) }) : null;
  const empty = row.kind === 'hold' ? t.athena.standup.row.hold_night : t.athena.standup.machine.night_empty;
  return (
    <Section level={2} title={F.tonight} meta={meta} className="sf-panel">
      {m.laneBlocks.length === 0 || row.kind === 'hold' ? <p className="typo-caption sf-panel__empty">{empty}</p> : (
        <>
          <Figure label={F.tonight} desc={runs.length > 0 ? runs.join(', ') : empty} height={Math.min(56, 18 * m.lanes + 6)}>
            <svg className="sf-night" aria-hidden="true">
              {Array.from({ length: m.lanes }, (_, i) => (
                <rect key={`l${i}`} className="su-lane-bg" x="0" y={pct(i * laneH)} width="100%" height={pct(laneH * 0.8)} rx="3" />
              ))}
              {m.laneBlocks.map((b) => (
                <rect key={b.id} className={mine.has(b.id) ? `su-blk su-blk--${b.tone}` : 'sf-other'} x={pct(b.start)} y={pct(b.lane * laneH)} width={pct(Math.max(0.004, b.end - b.start))} height={pct(laneH * 0.8)} rx="3" />
              ))}
              {now !== null && <line className="su-nowline" x1={pct(now)} x2={pct(now)} y1="0" y2="100%" />}
            </svg>
          </Figure>
          <div className="sf-axis" aria-hidden="true">
            {hourTicks(view.night, 2).map((tk) => <span key={tk.pos} className="typo-label" style={{ left: pct(tk.pos) }}>{tk.hour}</span>)}
          </div>
          <p className="typo-caption sf-panel__runs">{runs.length > 0 ? <Meta parts={runs} /> : empty}</p>
        </>
      )}
    </Section>
  );
}
