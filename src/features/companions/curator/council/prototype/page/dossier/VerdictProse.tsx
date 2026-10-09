// PROTOTYPE ROUND (spark council-readout). The council's own words under the
// claim: the summary broken at each member it walks through, and the items it
// says must be addressed, each tagged with the member that raised it.
import type { MouseEvent } from 'react';

import type { MustAddressItem } from '../../protoModel';
import { memberName, sectionId, splitSummary } from './format';
import { S } from './strings';

export function SummaryProse({ summary, members, fallback }: { summary: string; members: string[]; fallback: boolean }) {
  const parts = splitSummary(summary, members);
  return (
    <div className="flex flex-col gap-4">
      {fallback ? <p className="m-0 typo-body text-status-warning">{S.summaryFallback}</p> : null}
      {parts.map((part, i) =>
        part.member ? (
          <p key={i} className="m-0 typo-body-lg text-foreground">
            <strong className="font-semibold text-primary">{part.text.slice(0, part.member.length)}</strong>
            {part.text.slice(part.member.length)}
          </p>
        ) : (
          <p key={i} className="m-0 typo-body-lg text-foreground">
            {part.text}
          </p>
        ),
      )}
    </div>
  );
}

export function MustAddressList({ items, onJump }: { items: MustAddressItem[]; onJump: (key: string) => void }) {
  if (!items.length) return <p className="m-0 typo-body-lg text-foreground">{S.nothingToAddress}</p>;
  const jump = (key: string) => (e: MouseEvent) => {
    e.preventDefault();
    onJump(key);
  };
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((item, i) => (
        <li
          key={i}
          className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 rounded-card border border-status-warning/30 bg-status-warning/[0.05] px-4 py-3.5"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-status-warning/15 typo-data text-status-warning">
            {i + 1}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            {item.member ? (
              <a
                href={`#${sectionId(`member-${item.member}`)}`}
                onClick={jump(`member-${item.member}`)}
                className="self-start typo-heading text-primary underline-offset-4 hover:underline focus-ring"
              >
                {memberName(item.member)}
              </a>
            ) : (
              <span className="typo-heading text-muted">{S.general}</span>
            )}
            <p className="m-0 typo-body-lg text-foreground">{item.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
