/**
 * The chat card's rail section: who is in the thread, as faces. Each person
 * is a monogram with their name beside it, the Athena / you roles tinted, so
 * "who am I answering" reads without a sentence.
 */
import { Users } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DecisionItem, DecisionThreadMessage } from '../../../model/decisionModel';

const ROLE_INK: Record<DecisionThreadMessage['author'], string> = {
  user: 'text-primary',
  persona: 'text-foreground',
  athena: 'text-role-agent',
};

export function ThreadPeople({ item }: { item: DecisionItem }) {
  const people = new Map<string, DecisionThreadMessage['author']>();
  for (const m of item.thread?.messages ?? []) people.set(m.name, m.author);
  if (people.size === 0) return null;
  return (
    <section className="flex flex-col gap-2 pt-4" aria-label="In this thread">
      <Tooltip content="In this thread">
        <span className="flex items-center gap-1.5 typo-eyebrow text-foreground">
          <Users className="h-3.5 w-3.5" aria-hidden /> {people.size}
        </span>
      </Tooltip>
      <ul className="flex flex-col gap-1.5">
        {[...people].map(([name, author]) => (
          <li key={name} className={`flex items-center gap-2 typo-body ${ROLE_INK[author]}`}>
            <span className="au-monogram inline-flex h-6 w-6 items-center justify-center rounded-interactive typo-label" aria-hidden>
              {([...name][0] ?? '?').toUpperCase()}
            </span>
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
