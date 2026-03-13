import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_HEIGHT = 44;
const VIRTUALIZE_THRESHOLD = 50;

interface Props<T> {
  items: T[];
  renderRow: (item: T, index: number) => React.ReactNode;
  rowKey: (item: T) => string;
}

/**
 * Renders `<tbody>` rows with virtualization when item count exceeds threshold.
 * For small lists, renders all rows directly (no overhead).
 */
export function VirtualizedTableBody<T>({ items, renderRow, rowKey }: Props<T>) {
  const parentRef = useRef<HTMLTableSectionElement>(null);
  const shouldVirtualize = items.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current?.closest('.overflow-x-auto') as HTMLElement | null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: shouldVirtualize,
  });

  if (!shouldVirtualize) {
    return (
      <tbody>
        {items.map((item, idx) => (
          <tr key={rowKey(item)} className="border-b border-primary/10 hover:bg-secondary/10 transition-colors">
            {renderRow(item, idx)}
          </tr>
        ))}
      </tbody>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <tbody ref={parentRef} style={{ height: `${totalSize}px`, position: 'relative' }}>
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index]!;
        return (
          <tr
            key={rowKey(item)}
            className="border-b border-primary/10 hover:bg-secondary/10 transition-colors"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(item, virtualRow.index)}
          </tr>
        );
      })}
    </tbody>
  );
}
