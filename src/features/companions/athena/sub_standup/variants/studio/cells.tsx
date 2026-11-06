import { Sparkles } from 'lucide-react';

import { Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView, TickState } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { Track, type Axes } from './axis';
import { fill, STUDIO_COPY } from './copy';
import { MarkChips, Rug } from './marks';
import { StatePill } from './StatePill';

const TICK: Record<TickState, string> = { armed: 'is-armed', off: 'is-off', none: '' };

/** Name (600) over the project's last standups as a row of dots: filled = armed, ring = off, faint = not named. */
export function NameCell({ row }: { row: RowView }) {
  const armed = row.history?.filter((h) => h === 'armed').length ?? 0;
  const hint = row.history ? fill(STUDIO_COPY.history_hint, { n: armed, of: row.history.length }) : '';
  return (
    <div className="ss-cell ss-c1 ss-name">
      <span className="ss-name__text">{row.name}</span>
      {row.history && (
        <Hint content={hint}>
          <span className="ss-hist" role="img" aria-label={hint}>
            {row.history.map((h, i) => <i key={i} className={TICK[h]} />)}
          </span>
        </Hint>
      )}
    </div>
  );
}

/** Today: readable figures (icon + count) over a rug of where on the axis each act fell. */
export function TodayCell({ row, axes, rug }: { row: RowView; axes: Axes; rug: boolean }) {
  if (row.kind === 'hold') {
    return <div className="ss-cell ss-c2 ss-text"><span className="ss-ask ss-clamp2">{row.headline}</span></div>;
  }
  if (row.kind === 'agent') {
    return <div className="ss-cell ss-c2 ss-text"><span className="ss-ev ss-clamp2">{row.evidence}</span></div>;
  }
  const quiet = row.pastMarks.length === 0 && row.moved === 0;
  return (
    <div className="ss-cell ss-c2 ss-today">
      <Track ticks={axes.todayTicks} lane={quiet}>{rug && <Rug marks={row.pastMarks} />}</Track>
      {!quiet && <MarkChips marks={row.pastMarks} moved={row.moved} />}
    </div>
  );
}

type T = ReturnType<typeof useTranslation>['t'];
interface DecText { lead?: string; text: string; strong: boolean; pick?: boolean }

function decisionText(row: RowView, proposing: boolean, t: T): DecText {
  const d = STUDIO_COPY.decision;
  const r = t.athena.standup.row;
  switch (row.state) {
    case 'refused': return { text: row.refusal || d.refused, strong: false };
    case 'waits': return { text: row.ask?.options.length ? fill(d.your_call, { options: row.ask.options.join(' / ') }) : r.waits, strong: false };
    case 'blank': return { text: proposing && !row.evidence ? r.proposing : d.blank, strong: false };
    case 'filler': return { text: row.headline || r.filler, strong: Boolean(row.headline) };
    case 'skipped': return { text: row.headline || r.skipped, strong: false };
    case 'proposed': {
      const st = t.athena.standup.state;
      if (row.agentVerb) return { text: fill(d.agent, { verb: row.agentVerb === 'create' ? st.verb_create : st.verb_retune }), strong: false };
      const pick = row.proposals.find((p) => p.recommended);
      return pick
        ? { lead: fill(d.options, { n: row.proposals.length }), text: pick.text, strong: false, pick: true }
        : { text: fill(d.proposed_plain, { n: row.proposals.length }), strong: false };
    }
    default: return { text: row.headline || row.name, strong: true };
  }
}

/** Decision: the state badge on a fixed column, then the text (500 when decided, two lines, never clipped mid-word). */
export function DecisionCell({ row, proposing }: { row: RowView; proposing: boolean }) {
  const { t } = useTranslation();
  const { lead, text, strong, pick } = decisionText(row, proposing, t);
  return (
    <div className="ss-cell ss-c3 ss-dec">
      <StatePill row={row} />
      <span className={`ss-dec__text ss-clamp2 ${strong ? 'is-strong' : ''}`}>
        {lead && <span className="ss-dec__lead">{lead}</span>}
        {pick && <Sparkles className="ss-dec__spark" aria-label={STUDIO_COPY.decision.suggests} />}
        {text}
      </span>
    </div>
  );
}

/** Tonight: this row's forecast blocks on a rounded lane of the shared night axis, plus what it did after arming. */
export function TonightCell({ row, axes }: { row: RowView; axes: Axes }) {
  const { t } = useTranslation();
  if (row.kind === 'hold') {
    // A parked ask has no run tonight: an empty lane, the reason one hover away (not five repeats of it).
    return (
      <Hint content={t.athena.standup.row.hold_night}>
        <div className="ss-cell ss-c4 ss-night"><Track ticks={axes.nightTicks} nowPos={axes.nowPos} lane /></div>
      </Hint>
    );
  }
  return (
    <div className="ss-cell ss-c4 ss-night">
      <Track ticks={axes.nightTicks} nowPos={axes.nowPos} lane>
        {row.blocks.map((b) => (
          <i key={b.id} className={`ss-blk ss-blk--${b.tone} ss-rowblk`} style={{ left: pct(b.start), width: pct(Math.max(0.006, b.end - b.start)) }} />
        ))}
        {row.nightMarks.map((m) => <i key={m.id} className="ss-nightmark" style={{ left: pct(m.pos) }} />)}
      </Track>
    </div>
  );
}
