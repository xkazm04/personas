// The list body: a flat item stream of subcategory headings and rows, mapped
// straight through while it is small and virtualised once a level is big
// enough that a measure pass pays for itself.
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { RailRow } from './RailRow';
import type { RailRow as RailRowModel } from '../useGalaxyRows';

/** Below this many items, plain DOM reads better than a measure pass. */
export const VIRTUALIZE_ABOVE = 150;
const ROW_PX = 34;
const HEADING_PX = 30;

export type RailItem =
  | { kind: 'heading'; key: string; label: string }
  | { kind: 'row'; key: string; row: RailRowModel; index: number };

interface Props {
  items: RailItem[];
  selectedIndex: number;
  onSelect: (row: RailRowModel, index: number) => void;
  onHover: (row: RailRowModel | null) => void;
}

function Heading({ label }: { label: string }) {
  return (
    <div className="px-2 pb-1 pt-2.5 typo-heading uppercase tracking-[0.1em] text-muted-dark">{label}</div>
  );
}

function Item({ item, selectedIndex, onSelect, onHover }: Props & { item: RailItem }) {
  if (item.kind === 'heading') return <Heading label={item.label} />;
  return (
    <RailRow
      row={item.row}
      selected={item.index === selectedIndex}
      onSelect={() => onSelect(item.row, item.index)}
      onHover={(hovering) => onHover(hovering ? item.row : null)}
    />
  );
}

export function RailList(props: Props) {
  const { items } = props;
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualise = items.length > VIRTUALIZE_ABOVE;
  const virtualizer = useVirtualizer({
    count: virtualise ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (items[i]?.kind === 'heading' ? HEADING_PX : ROW_PX),
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3.5 pt-1.5">
      {virtualise ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const item = items[v.index];
            if (!item) return null;
            return (
              <div
                key={item.key}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${v.start}px)` }}
                data-index={v.index}
              >
                <Item {...props} item={item} />
              </div>
            );
          })}
        </div>
      ) : (
        items.map((item) => <Item key={item.key} {...props} item={item} />)
      )}
    </div>
  );
}
