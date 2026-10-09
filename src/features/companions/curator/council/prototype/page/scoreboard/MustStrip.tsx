// PROTOTYPE ROUND (spark council-readout). What the council says must be
// addressed, as a strip of numbered cards under the band; a card that names
// a member selects that member's column.
import Button from '@/features/shared/components/buttons/Button';

import type { MustAddressItem } from '../../protoModel';
import { memberName } from './format';
import { S } from './strings';

export function MustStrip({ items, onMember }: { items: MustAddressItem[]; onMember: (name: string) => void }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="sb-must-h" className="flex flex-col gap-3">
      <h2 id="sb-must-h" className="m-0 flex items-baseline gap-3 typo-section-title">
        {S.mustAddress}
        <span className="typo-data text-muted">{items.length}</span>
      </h2>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] gap-3 p-0">
        {items.map((item, i) => (
          <li
            key={i}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 rounded-card border border-status-warning/30 bg-status-warning/[0.05] px-4 py-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-status-warning/15 typo-data text-status-warning">
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col items-start gap-1">
              {item.member ? (
                <Button variant="link" size="sm" className="!px-0" onClick={() => onMember(item.member as string)}>
                  <span className="typo-heading">{memberName(item.member)}</span>
                </Button>
              ) : (
                <span className="typo-heading text-muted">{S.general}</span>
              )}
              <p className="m-0 typo-body-lg text-foreground">{item.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
