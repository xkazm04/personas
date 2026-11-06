import { Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView, TickState } from '../../model/types';
import { pct } from '../../parts/svgUnits';
import { Track, type Axes } from './axis';
import { fill, LEDGER_COPY } from './copy';
import { MarkChips, Rug } from './marks';
import { StatePill } from './StatePill';

const TICK: Record<TickState, string> = { armed: 'is-armed', off: 'is-off', none: '' };

/** Name + the project's last standups (armed / off / not named) as a fixed-width strip. */
export function NameCell({ row }: { row: RowView }) {
  const armed = row.history?.filter((h) => h === 'armed').length ?? 0;
  return (
    <div className="sl-cell sl-c1 sl-name">
      <span className="sl-name__text sl-clamp2 typo-body k-strong text-foreground">{row.name}</span>
      {row.history && (
        <Hint content={fill(LEDGER_COPY.history_hint, { n: armed, of: row.history.length })}>
          <span className="sl-hist" role="img" aria-label={fill(LEDGER_COPY.history_hint, { n: armed, of: row.history.length })}>
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
    return <div className="sl-cell sl-c2 sl-text"><span className="typo-body text-foreground">{row.headline}</span></div>;
  }
  if (row.kind === 'agent') {
    return <div className="sl-cell sl-c2 sl-text"><span className="typo-caption sl-clamp2">{row.evidence}</span></div>;
  }
  const quiet = row.pastMarks.length === 0 && row.moved === 0;
  return (
    <div className="sl-cell sl-c2 sl-today">
      <Track ticks={axes.todayTicks} trackY={quiet ? '50%' : null}>{rug && <Rug marks={row.pastMarks} />}</Track>
      {!quiet && <MarkChips marks={row.pastMarks} moved={row.moved} />}
    </div>
  );
}

function decisionText(row: RowView, proposing: boolean, t: ReturnType<typeof useTranslation>['t']): { text: string; strong: boolean } {
  const d = LEDGER_COPY.decision;
  const r = t.athena.standup.row;
  switch (row.state) {
    case 'refused': return { text: row.refusal || d.refused, strong: false };
    case 'waits': return { text: row.ask?.options.length ? fill(d.your_call, { options: row.ask.options.join(' / ') }) : r.waits, strong: false };
    case 'blank': return { text: proposing && !row.evidence ? r.proposing : d.blank, strong: false };
    case 'filler': return { text: row.headline || r.filler, strong: Boolean(row.headline) };
    case 'skipped': return { text: row.headline || r.skipped, strong: false };
    case 'proposed': {
      if (row.agentVerb) return { text: fill(d.agent, { verb: row.agentVerb === 'create' ? t.athena.standup.state.verb_create : t.athena.standup.state.verb_retune }), strong: false };
      const pick = row.proposals.find((p) => p.recommended);
      return { text: pick ? fill(d.proposed, { n: row.proposals.length, pick: pick.text }) : fill(d.proposed_plain, { n: row.proposals.length }), strong: false };
    }
    default: return { text: row.headline || row.name, strong: true };
  }
}

/** Decision: the state pill on a fixed column, then the full text (two lines; a decided direction never clips). */
export function DecisionCell({ row, proposing }: { row: RowView; proposing: boolean }) {
  const { t } = useTranslation();
  const { text, strong } = decisionText(row, proposing, t);
  return (
    <div className="sl-cell sl-c3 sl-dec">
      <StatePill row={row} />
      <span className={strong ? 'typo-body text-foreground' : 'typo-caption sl-clamp2'}>{text}</span>
    </div>
  );
}

/** Tonight: this row's forecast blocks on the shared night axis, plus what it did after arming. */
export function TonightCell({ row, axes }: { row: RowView; axes: Axes }) {
  const { t } = useTranslation();
  if (row.kind === 'hold') {
    // A parked ask has no run tonight: an empty lane, the reason one hover away (not five repeats of it).
    return (
      <Hint content={t.athena.standup.row.hold_night}>
        <div className="sl-cell sl-c4 sl-night"><Track ticks={axes.nightTicks} nowPos={axes.nowPos} /></div>
      </Hint>
    );
  }
  return (
    <div className="sl-cell sl-c4 sl-night">
      <Track ticks={axes.nightTicks} nowPos={axes.nowPos}>
        {row.blocks.map((b) => (
          <svg key={b.id} x={pct(b.start)} y="50%" width={pct(Math.max(0.006, b.end - b.start))} overflow="visible">
            <rect className={`sl-blk sl-blk--${b.tone}`} y="-8" width="100%" height="16" rx="3" />
          </svg>
        ))}
        {row.nightMarks.map((m) => <circle key={m.id} className="sl-nightmark" cx={pct(m.pos)} cy="50%" r="2.5" />)}
      </Track>
    </div>
  );
}
