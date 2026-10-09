// What the council asks for before a decision, as the cover states it: the
// count as a figure, the first two items in full, and how many more the
// report holds.
//
// The two shown are the two that matter most - a floor hit, then the
// severest finding - and three members "unmeasured for the same reason"
// count once, not three times (`buildCards`).
import { useTranslation } from '@/i18n/useTranslation';

import { MemberIcon, useMemberName } from './marks';
import type { MustCard } from './verdictModel';

function Tag({ card }: { card: MustCard }) {
  const { t } = useTranslation();
  const w = t.council.verdict;
  if (card.kind === 'floor') return <span className="typo-label text-status-error">{w.tag_floor}</span>;
  if (card.kind === 'unmeasured') return <span className="typo-label text-muted">{w.not_measured}</span>;
  if (card.finding?.severity === 'high') return <span className="typo-label text-status-error">{w.tag_high}</span>;
  return null;
}

export function MustPreview({ cards }: { cards: MustCard[] }) {
  const { t, tx } = useTranslation();
  const w = t.council.verdict;
  const name = useMemberName();
  if (cards.length === 0) {
    return <p className="m-0 typo-body-lg text-foreground">{w.must_none}</p>;
  }
  return (
    <section className="flex flex-col gap-4" data-testid="council-verdict-must">
      <h3 className="m-0 flex items-baseline gap-3">
        <span className="typo-data-lg tabular-nums text-primary">{cards.length}</span>
        <span className="typo-heading text-foreground">{cards.length === 1 ? w.must_one : w.must_other}</span>
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
      {cards.length > 2 ? <span className="typo-body text-muted">{tx(w.must_more, { n: cards.length - 2 })}</span> : null}
    </section>
  );
}
