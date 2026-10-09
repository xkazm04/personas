// PROTOTYPE ROUND (spark council-readout, direction G). The board itself:
// with no member picked, the must-address cards; with one picked, that
// member's cards and then every other finding it raised, severest first.
import type { Seat } from '../../../table/runModel';
import { evidenceFor, memberFindings, nextInLine, type BoardCard } from './boardModel';
import { FindingItem } from './FindingItem';
import { MemberIcon, useMemberName } from './marks';
import { MustCard } from './MustCard';

const S = {
  must: 'Must address',
  mustNone: 'The council asks for nothing before a decision.',
  others: 'More findings',
  next: 'Next in line',
  none: 'This member raised no findings.',
  notMeasured: 'Not measured this round',
  pick: (n: number) => `${n} more findings sit behind the members above. Pick one to read them.`,
};

function Heading({ children, count }: { children: string; count?: number }) {
  return (
    <h3 className="m-0 flex items-baseline gap-3 typo-section-title text-foreground">
      {children}
      {count != null ? <span className="typo-data-lg tabular-nums text-primary">{count}</span> : null}
    </h3>
  );
}

export function BoardBody({
  cards,
  seats,
  active,
  reasons,
}: {
  cards: BoardCard[];
  seats: Seat[];
  active: string | null;
  reasons: Record<string, string>;
}) {
  const name = useMemberName();
  const seat = active ? (seats.find((s) => s.name === active) ?? null) : null;
  const shownCards = seat ? cards.filter((c) => c.members.includes(seat.name)) : cards;
  const rest = seat ? memberFindings(seat, cards) : [];
  const fill = seat ? [] : nextInLine(seats, cards, 4 - cards.length);
  const hidden = seats.reduce((n, s) => n + memberFindings(s, cards).length, 0) - fill.length;

  return (
    <div className="flex flex-col gap-6">
      {seat ? (
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
            <MemberIcon name={seat.name} className="h-6 w-6" />
          </span>
          <h3 className="m-0 typo-heading-lg capitalize text-foreground">{name(seat.name)}</h3>
          {seat.score == null ? <span className="typo-body-lg text-muted">{S.notMeasured}</span> : null}
        </div>
      ) : (
        <Heading count={cards.length}>{S.must}</Heading>
      )}

      {shownCards.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {shownCards.map((card) => (
            <MustCard
              key={card.key}
              card={card}
              reason={card.members[0] ? (reasons[card.members[0]] ?? null) : null}
              hideMembers={seat != null && card.members.length === 1}
            />
          ))}
        </div>
      ) : !seat ? (
        <p className="m-0 typo-body-lg text-foreground">{S.mustNone}</p>
      ) : null}

      {seat ? (
        <>
          {seat.score == null && reasons[seat.name] && shownCards.length === 0 ? (
            <p className="m-0 max-w-[80ch] typo-body-lg text-foreground">{reasons[seat.name]}</p>
          ) : null}
          {rest.length > 0 ? (
            <>
              <Heading count={rest.length}>{S.others}</Heading>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {rest.map((f) => (
                  <FindingItem key={f.id} finding={f} evidence={evidenceFor(f, seat, 4)} />
                ))}
              </div>
            </>
          ) : seat.findings.length === 0 ? (
            <p className="m-0 typo-body-lg text-muted">{S.none}</p>
          ) : null}
        </>
      ) : (
        <>
          {fill.length > 0 ? (
            <>
              <Heading>{S.next}</Heading>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {fill.map(({ seat: s, finding }) => (
                  <FindingItem
                    key={`${s.name}-${finding.id}`}
                    finding={finding}
                    evidence={evidenceFor(finding, s, 4)}
                    member={
                      <span className="inline-flex items-center gap-2 typo-heading capitalize text-foreground">
                        <span className="text-primary">
                          <MemberIcon name={s.name} className="h-[18px] w-[18px]" />
                        </span>
                        {name(s.name)}
                      </span>
                    }
                  />
                ))}
              </div>
            </>
          ) : null}
          {hidden > 0 ? <p className="m-0 typo-body-lg text-muted">{S.pick(hidden)}</p> : null}
        </>
      )}
    </div>
  );
}
