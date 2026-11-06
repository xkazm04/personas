import { Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView, TickState } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { Track, type Axes } from './axis';
import { ED_COPY, fill } from './copy';
import { MarkChips, Rug } from './marks';
import { StateMark } from './StateMark';

const TICK: Record<TickState, string> = { armed: 'is-armed', off: 'is-off', none: '' };

/** The project name in the serif, its last standups as a fine tick rule beneath (tall = armed, flat = off). */
export function NameCell({ row }: { row: RowView }) {
  const armed = row.history?.filter((h) => h === 'armed').length ?? 0;
  const hint = row.history ? fill(ED_COPY.history_hint, { n: armed, of: row.history.length }) : '';
  return (
    <div className="se-cell se-c1 se-name">
      <span className="se-name__text se-serif se-clamp2">{row.name}</span>
      {row.history && (
        <Hint content={hint}>
          <span className="se-hist" role="img" aria-label={hint}>
            {row.history.map((h, i) => <i key={i} className={TICK[h]} />)}
          </span>
        </Hint>
      )}
    </div>
  );
}

/** Today: readable figures (icon + tabular count) over a rug of where on the axis each act fell. */
export function TodayCell({ row, axes, rug }: { row: RowView; axes: Axes; rug: boolean }) {
  if (row.kind === 'hold') {
    return <div className="se-cell se-c2 se-text"><span className="se-dtext se-clamp2">{row.headline}</span></div>;
  }
  if (row.kind === 'agent') {
    return <div className="se-cell se-c2 se-text"><span className="se-dtext se-clamp2">{row.evidence}</span></div>;
  }
  const quiet = row.pastMarks.length === 0 && row.moved === 0;
  return (
    <div className="se-cell se-c2 se-today">
      <Track ticks={axes.todayTicks} trackY={quiet ? '50%' : null}>{rug && <Rug marks={row.pastMarks} />}</Track>
      {!quiet && <MarkChips marks={row.pastMarks} moved={row.moved} />}
    </div>
  );
}

type Tone = 'strong' | 'done' | 'plain' | 'off';
interface DText { lead?: string; text: string; tone: Tone }

function decisionText(row: RowView, proposing: boolean, t: ReturnType<typeof useTranslation>['t']): DText {
  const d = ED_COPY.decision;
  const r = t.athena.standup.row;
  switch (row.state) {
    case 'refused': return { text: row.refusal || d.refused, tone: 'off' };
    case 'waits': return { text: row.ask?.options.length ? fill(d.your_call, { options: row.ask.options.join(' / ') }) : r.waits, tone: 'plain' };
    case 'blank': return { text: proposing && !row.evidence ? r.proposing : d.blank, tone: 'off' };
    case 'filler': return { text: row.headline || r.filler, tone: row.headline ? 'plain' : 'off' };
    case 'skipped': return { text: row.headline || r.skipped, tone: 'off' };
    case 'proposed': {
      if (row.agentVerb) return { text: fill(d.agent, { verb: row.agentVerb === 'create' ? t.athena.standup.state.verb_create : t.athena.standup.state.verb_retune }), tone: 'plain' };
      const pick = row.proposals.find((p) => p.recommended);
      return pick
        ? { lead: fill(d.proposed_lead, { n: row.proposals.length }), text: pick.text, tone: 'plain' }
        : { text: fill(d.proposed_plain, { n: row.proposals.length }), tone: 'plain' };
    }
    case 'done': return { text: row.headline || row.name, tone: 'done' };
    default: return { text: row.headline || row.name, tone: 'strong' };
  }
}

/** Decision: the state mark on a fixed measure, then the text; a decided direction is set in the serif and never clips. */
export function DecisionCell({ row, proposing }: { row: RowView; proposing: boolean }) {
  const { t } = useTranslation();
  const { lead, text, tone } = decisionText(row, proposing, t);
  const cls = tone === 'strong' || tone === 'done' ? `se-dtext se-dtext--strong ${tone === 'done' ? 'se-dtext--done' : ''}` : `se-dtext se-clamp2 ${tone === 'off' ? 'se-dtext--off' : ''}`;
  return (
    <div className="se-cell se-c3 se-dec">
      <StateMark row={row} />
      <span className={cls}>{lead ? <>{lead} <em>{text}</em></> : text}</span>
    </div>
  );
}

/** Tonight: this row's forecast blocks as thin bars on the shared night axis, plus what it did after arming. */
export function TonightCell({ row, axes }: { row: RowView; axes: Axes }) {
  const { t } = useTranslation();
  if (row.kind === 'hold') {
    // A parked ask has no run tonight: an empty lane, the reason one hover away (not five repeats of it).
    return (
      <Hint content={t.athena.standup.row.hold_night}>
        <div className="se-cell se-c4"><Track ticks={axes.nightTicks} nowPos={axes.nowPos} /></div>
      </Hint>
    );
  }
  return (
    <div className="se-cell se-c4">
      <Track ticks={axes.nightTicks} nowPos={axes.nowPos}>
        {row.blocks.map((b) => (
          <svg key={b.id} x={pct(b.start)} y="50%" width={pct(Math.max(0.006, b.end - b.start))} overflow="visible">
            <rect className="se-blk-ground" y="-5" width="100%" height="10" />
            <rect className={`se-blk se-blk--${b.tone}`} y="-5" width="100%" height="10" rx="1" />
          </svg>
        ))}
        {row.nightMarks.map((m) => <circle key={m.id} className="se-nightmark" cx={pct(m.pos)} cy="50%" r="2" />)}
      </Track>
    </div>
  );
}
