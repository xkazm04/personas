import { useTranslation } from '@/i18n/useTranslation';
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';
import type { EventMark, RowView, TickState, TimeBlock } from '../model/types';
import { StateChip } from './StateChip';
import { pct } from './svgUnits';


/** One drawn glyph per away-act kind, centred on 0,0 (shape AND colour carry the kind). */
const SHAPE: Record<StandupEventKind, string> = {
  push: 'M0,-6 L6,5 L-6,5 Z',
  dispatch: 'M-5,-5 L6,0 L-5,5 Z',
  ask_parked: 'M-5,-5 H5 V5 H-5 Z',
  ask_delegated: 'M0,-6 L6,0 L0,6 L-6,0 Z',
  stop: 'M-5,-3 L-3,-5 L0,-2 L3,-5 L5,-3 L2,0 L5,3 L3,5 L0,2 L-3,5 L-5,3 L-2,0 Z',
  drift: 'M-6,2 L-2,-3 L2,2 L6,-3 L6,1 L2,6 L-2,1 L-6,6 Z',
  agent_created: 'M0,-6 L2,-2 L6,-2 L3,1 L4,6 L0,3 L-4,6 L-3,1 L-6,-2 L-2,-2 Z',
  agent_retuned: 'M0,-6 L2,-2 L6,-2 L3,1 L4,6 L0,3 L-4,6 L-3,1 L-6,-2 L-2,-2 Z',
  sweep: 'M-2.5,-2.5 H2.5 V2.5 H-2.5 Z',
  backfill: 'M-3,-3 H3 V3 H-3 Z',
};

export function MarkGlyphs({ marks }: { marks: readonly EventMark[] }) {
  return (
    <>
      {marks.map((m) => (
        <svg key={m.id} x={pct(m.pos)} y="50%" overflow="visible">
          <path className={`su-k su-k--${m.kind}`} d={SHAPE[m.kind]} />
        </svg>
      ))}
    </>
  );
}

export function Blocks({ blocks }: { blocks: readonly TimeBlock[] }) {
  return (
    <>
      {blocks.map((b) => (
        <rect key={b.id} className={`su-blk su-blk--${b.tone}`} x={pct(b.start)} y="22%" width={pct(Math.max(0.004, b.end - b.start))} height="56%" rx="3" />
      ))}
    </>
  );
}

const TICK: Record<TickState, string> = { armed: 'is-armed', off: 'is-off', none: '' };

export function NameCell({ row }: { row: RowView }) {
  const { t } = useTranslation();
  return (
    <div className="su-name">
      <span className="su-name__text typo-body k-strong text-foreground">{row.name}</span>
      {row.history && (
        <span className="su-hist" role="img" aria-label={t.athena.standup.row.history_label}>
          {row.history.map((h, i) => <i key={i} className={TICK[h]} />)}
        </span>
      )}
    </div>
  );
}

/** Today: the away log as glyphs on the shared axis, or one honest line when there is nothing to draw. */
export function PastCell({ row }: { row: RowView }) {
  const { t, tx } = useTranslation();
  const r = t.athena.standup.row;
  if (row.kind === 'hold') return <div className="su-cell su-cell--text"><span className="su-clip typo-body text-foreground">{row.headline}</span></div>;
  if (row.kind === 'agent') return <div className="su-cell su-cell--text"><span className="typo-caption line-clamp-2">{row.evidence}</span></div>;
  if (row.pastMarks.length === 0) {
    return <div className="su-cell su-cell--text"><span className="typo-caption">{row.moved > 0 ? tx(r.moved, { n: row.moved }) : r.no_movement}</span></div>;
  }
  return <div className="su-cell"><svg role="img" aria-label={tx(r.acts_label, { n: row.pastMarks.length })}><MarkGlyphs marks={row.pastMarks} /></svg></div>;
}

export function NowCell({ row, proposing }: { row: RowView; proposing: boolean }) {
  const { t, tx } = useTranslation();
  const r = t.athena.standup.row;
  let text: string;
  if (row.state === 'refused') text = r.refused;
  else if (row.state === 'waits') text = row.ask?.options.join(' / ') || r.waits;
  else if (row.state === 'blank') text = proposing && !row.evidence ? r.proposing : r.blank;
  else if (row.state === 'filler') text = r.filler;
  else if (row.state === 'skipped') text = r.skipped;
  else if (row.state === 'proposed') text = row.agentVerb ? row.name : tx(r.directions, { n: row.proposals.length });
  else text = row.headline || row.name;
  const quiet = ['proposed', 'blank', 'filler', 'skipped', 'refused'].includes(row.state);
  return (
    <div className="su-cell su-now">
      <StateChip row={row} />
      <span className={`su-clip ${quiet ? 'typo-caption' : 'typo-body text-foreground'}`}>{text}</span>
    </div>
  );
}

/** Tonight: this row's forecast blocks plus whatever it did after the plan was armed. */
export function NightCell({ row, nowPos }: { row: RowView; nowPos: number | null }) {
  const { t } = useTranslation();
  if (row.kind === 'hold') return <div className="su-cell su-cell--text"><span className="typo-caption">{t.athena.standup.row.hold_night}</span></div>;
  if (row.blocks.length === 0 && row.nightMarks.length === 0) return <div className="su-cell" />;
  return (
    <div className="su-cell">
      <svg aria-hidden="true">
        <Blocks blocks={row.blocks} />
        <MarkGlyphs marks={row.nightMarks} />
        {nowPos !== null && <line className="su-nowline" x1={pct(nowPos)} x2={pct(nowPos)} y1="0" y2="100%" opacity="0.5" />}
      </svg>
    </div>
  );
}
