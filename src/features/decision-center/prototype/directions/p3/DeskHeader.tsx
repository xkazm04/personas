/** The one header anatomy every modal type shares: what kind, how urgent, from whom, where in the queue. */
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { chipOf, type DecisionItem } from '../../../model/decisionModel';
import { CHIP_META } from './model';
import { TierTag } from './parts';

interface Props {
  item: DecisionItem;
  titleId: string;
  index: number;
  total: number;
  onWalk: (d: 1 | -1) => void;
  onClose: () => void;
}

export function DeskHeader({ item, titleId, index, total, onWalk, onClose }: Props) {
  const meta = CHIP_META[chipOf(item.kind)];
  const Icon = meta.icon;
  return (
    <header className="flex flex-col gap-2 px-6 pb-3 pt-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5 typo-label text-primary">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {meta.label} · {item.kind}
        </span>
        <TierTag item={item} />
        <span className="flex min-w-0 items-center gap-1.5 typo-caption">
          <span className="truncate">{item.source.label}{item.source.sublabel ? ` · ${item.source.sublabel}` : ''}</span>
          <span aria-hidden>·</span>
          <RelativeTime timestamp={item.createdAt} />
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Tooltip content="Previous (← or K)">
            <Button variant="ghost" size="icon-sm" onClick={() => onWalk(-1)} disabled={index === 0} aria-label="Previous item">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
          </Tooltip>
          <span className="typo-data tabular-nums text-foreground">{index + 1} / {total}</span>
          <Tooltip content="Next (→ or J)">
            <Button variant="ghost" size="icon-sm" onClick={() => onWalk(1)} disabled={index >= total - 1} aria-label="Next item">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="Back (Esc)">
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </Tooltip>
        </span>
      </div>
      <h2 id={titleId} className="typo-heading-lg text-foreground">{item.title}</h2>
    </header>
  );
}
