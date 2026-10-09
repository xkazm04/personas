// PROTOTYPE ROUND (spark council-readout, direction H). What the council
// asks for before a decision, as the cover states it: the count as a
// figure, the first two items in full, and how many more the report holds.
//
// Items are the Findings board's cards (`buildCards`), so the two shown are
// the two that matter most - a floor hit, then the severest finding - and
// three members "unmeasured for the same reason" count once, not three times.
import type { BoardCard } from '../findings/boardModel';
import { MemberIcon, useMemberName } from '../findings/marks';

const S = {
  heading: (n: number) => (n === 1 ? 'thing to address' : 'things to address'),
  none: 'The council asks for nothing before a decision.',
  more: (n: number) => `and ${n} more in the full report`,
  notMeasured: 'not measured',
  floor: 'floor hit',
  high: 'high',
};

function Tag({ card }: { card: BoardCard }) {
  if (card.kind === 'floor') return <span className="typo-label text-status-error">{S.floor}</span>;
  if (card.kind === 'unmeasured') return <span className="typo-label text-muted">{S.notMeasured}</span>;
  if (card.finding?.severity === 'high') return <span className="typo-label text-status-error">{S.high}</span>;
  return null;
}

export function MustPreview({ cards }: { cards: BoardCard[] }) {
  const name = useMemberName();
  if (cards.length === 0) {
    return <p className="m-0 typo-body-lg text-foreground">{S.none}</p>;
  }
  return (
    <section className="flex flex-col gap-4" data-testid="council-hybrid-must">
      <h3 className="m-0 flex items-baseline gap-3">
        <span className="typo-data-lg tabular-nums text-primary">{cards.length}</span>
        <span className="typo-heading text-foreground">{S.heading(cards.length)}</span>
      </h3>
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {cards.slice(0, 2).map((card) => (
          <li key={card.key} className="flex flex-col gap-1.5 border-l-[3px] border-primary/40 pl-4">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {card.members.map((m) => (
                <span key={m} className="inline-flex items-center gap-2 typo-label capitalize text-primary">
                  <MemberIcon name={m} className="h-4 w-4" />
                  {name(m)}
                </span>
              ))}
              <Tag card={card} />
            </span>
            <span className="line-clamp-3 typo-body-lg text-foreground">{card.text}</span>
          </li>
        ))}
      </ol>
      {cards.length > 2 ? <span className="typo-body text-muted">{S.more(cards.length - 2)}</span> : null}
    </section>
  );
}
