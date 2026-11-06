import { Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView, TickState } from '../model/types';
import { pct } from './svgUnits';
import { Track, type Axes } from './axis';
import { MarkChips, Rug } from './marks';
import { StateMark } from './StateMark';

const TICK: Record<TickState, string> = { armed: 'is-armed', off: 'is-off', none: '' };

/** Name + the project's last standups as fine strokes: full = armed, stub = off, dot = not named. */
export function NameCell({ row }: { row: RowView }) {
  const { t, tx } = useTranslation();
  const armed = row.history?.filter((h) => h === 'armed').length ?? 0;
  const hint = row.history ? tx(t.athena.standup.console.history_hint, { n: armed, of: row.history.length }) : '';
  return (
    <div className="sc-cell sc-c1 sc-name">
      <span className="sc-name__text sc-clamp2">{row.name}</span>
      {row.history && (
        <Hint content={hint}>
          <span className="sc-hist" role="img" aria-label={hint}>
            {row.history.map((h, i) => <i key={i} className={TICK[h]} />)}
          </span>
        </Hint>
      )}
    </div>
  );
}

/** Today: mono figures (glyph + count) over a rug of where on the axis each act fell. */
export function TodayCell({ row, axes, rug }: { row: RowView; axes: Axes; rug: boolean }) {
  if (row.kind === 'hold') {
    return <div className="sc-cell sc-c2 sc-text"><span className="sc-prose sc-clamp2">{row.headline}</span></div>;
  }
  if (row.kind === 'agent') {
    return <div className="sc-cell sc-c2 sc-text"><span className="sc-prose sc-prose--dim sc-clamp2">{row.evidence}</span></div>;
  }
  const quiet = row.pastMarks.length === 0 && row.moved === 0;
  return (
    <div className="sc-cell sc-c2 sc-today">
      <Track ticks={axes.todayTicks} trackY={quiet ? '50%' : null}>{rug && <Rug marks={row.pastMarks} />}</Track>
      {!quiet && <MarkChips marks={row.pastMarks} moved={row.moved} />}
    </div>
  );
}

interface Said { lead?: string; text: string; strong: boolean }

function decisionText(row: RowView, proposing: boolean, { t, tx }: ReturnType<typeof useTranslation>): Said {
  const d = t.athena.standup.console.decision;
  const r = t.athena.standup.row;
  switch (row.state) {
    case 'refused': return { text: row.refusal || d.refused, strong: false };
    case 'waits': return { text: row.ask?.options.length ? row.ask.options.join(' / ') : r.waits, strong: false };
    case 'blank': return { text: proposing && !row.evidence ? r.proposing : d.blank, strong: false };
    case 'filler': return { text: row.headline || r.filler, strong: false };
    case 'skipped': return { text: row.headline || r.skipped, strong: false };
    case 'proposed': {
      if (row.agentVerb) return { text: tx(d.agent, { verb: row.agentVerb === 'create' ? t.athena.standup.state.verb_create : t.athena.standup.state.verb_retune }), strong: false };
      const pick = row.proposals.find((p) => p.recommended);
      return pick
        ? { lead: tx(d.options, { n: row.proposals.length }), text: pick.text, strong: false }
        : { text: tx(d.proposed_plain, { n: row.proposals.length }), strong: false };
    }
    default: return { text: row.headline || row.name, strong: true };
  }
}

/** Decision: the state mark on its fixed column, then the text (a decided direction never clips). */
export function DecisionCell({ row, proposing }: { row: RowView; proposing: boolean }) {
  const { lead, text, strong } = decisionText(row, proposing, useTranslation());
  return (
    <div className="sc-cell sc-c3 sc-dec">
      <StateMark row={row} />
      <span className={strong ? 'sc-dec__text is-strong sc-clamp2' : 'sc-dec__text sc-clamp1'}>
        {lead && <span className="sc-dec__lead">{lead}</span>}
        {text}
      </span>
    </div>
  );
}

/** Tonight: this row's forecast blocks as fine bars on the shared night axis, plus what ran after arming. */
export function TonightCell({ row, axes }: { row: RowView; axes: Axes }) {
  const { t } = useTranslation();
  if (row.kind === 'hold') {
    // A parked ask has no run tonight: an empty lane, the reason one hover away (not five repeats of it).
    return (
      <Hint content={t.athena.standup.row.hold_night}>
        <div className="sc-cell sc-c4 sc-night"><Track ticks={axes.nightTicks} nowPos={axes.nowPos} /></div>
      </Hint>
    );
  }
  return (
    <div className="sc-cell sc-c4 sc-night">
      <Track ticks={axes.nightTicks} nowPos={axes.nowPos}>
        {row.blocks.map((b) => (
          <svg key={b.id} x={pct(b.start)} y="50%" width={pct(Math.max(0.006, b.end - b.start))} overflow="visible">
            <rect className={`sc-blk sc-blk--${b.tone}`} y="-4" width="100%" height="8" rx="1" />
          </svg>
        ))}
        {row.nightMarks.map((m) => <circle key={m.id} className="sc-nightmark" cx={pct(m.pos)} cy="50%" r="2" />)}
      </Track>
    </div>
  );
}
