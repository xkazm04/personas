/**
 * The sheet's head, in two parts that move differently:
 *  - SheetBar is chrome: kind, where you are in the queue, walk and close.
 *    It stays put while items change under it.
 *  - ItemHead is content: the ask itself, who raised it and when. It travels
 *    with the item (direction-aware in, verdict-shaped out).
 */
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { chipOf, type DecisionItem } from '../../../model/decisionModel';
import { COPY } from './copy';
import { Kbd } from './Kbd';
import { CHIP_ICON, TONE_CHIP } from './meta';

export function SheetBar({ item, index, total, scope, onWalk, onClose }: {
  item: DecisionItem;
  index: number;
  total: number;
  scope: string;
  onWalk: (d: 1 | -1) => void;
  onClose: () => void;
}) {
  const Icon = CHIP_ICON[chipOf(item.kind)];
  return (
    <div className="flex items-center gap-3 border-b p1-hair p1-band px-5 py-2.5">
      <Icon className="h-4 w-4 text-primary" aria-hidden />
      <span className="typo-eyebrow text-foreground">{COPY.kind[item.kind]}</span>
      <span className="ml-auto typo-caption tabular-nums whitespace-nowrap">
        {index + 1} {COPY.sheet.of} {total} {COPY.sheet.in} {scope}
      </span>
      <div className="flex items-center gap-0.5">
        <Tooltip content={<span className="inline-flex items-center gap-1.5">{COPY.sheet.prev}<Kbd>←</Kbd></span>}>
          <Button variant="ghost" size="icon-sm" aria-label={COPY.sheet.prev} onClick={() => onWalk(-1)} disabled={total < 2}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={<span className="inline-flex items-center gap-1.5">{COPY.sheet.next}<Kbd>→</Kbd></span>}>
          <Button variant="ghost" size="icon-sm" aria-label={COPY.sheet.next} onClick={() => onWalk(1)} disabled={total < 2}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content={<span className="inline-flex items-center gap-1.5">{COPY.sheet.close}<Kbd>Esc</Kbd></span>}>
          <Button variant="ghost" size="icon-sm" aria-label={COPY.sheet.close} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

export function ItemHead({ item, titleId }: { item: DecisionItem; titleId: string }) {
  return (
    <div className="px-6 pb-3 pt-5">
      <h2 id={titleId} className="typo-heading-lg text-foreground">{item.title}</h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="typo-body text-foreground">{item.source.label}</span>
        {item.source.sublabel && <span className="typo-caption">· {item.source.sublabel}</span>}
        <span className="typo-caption">·</span>
        <RelativeTime timestamp={item.createdAt} className="typo-caption" />
        {item.tags.map((tag) => (
          <span key={tag.id} className={`rounded-interactive border px-1.5 py-px typo-label ${TONE_CHIP[tag.tone]}`}>
            {tag.label}
          </span>
        ))}
      </div>
    </div>
  );
}
