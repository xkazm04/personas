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
    // The vertical scroll container must be opted in explicitly by the caller
    // (max-height + overflow-y-auto + data-virtual-scroll); the old
    // '.overflow-x-auto' target only scrolled horizontally, so scrollTop
    // stayed 0 and rows past the first viewport never materialized.
    getScrollElement: () => parentRef.current?.closest('[data-virtual-scroll]') as HTMLElement | null,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: shouldVirtualize,
  });

  if (!shouldVirtualize) {
    return (
      <tbody>
        {items.map((item, idx) => (
          <tr key={rowKey(item)} className="border-b border-primary/10 hover:bg-secondary/10 transition-colors animate-fade-slide-in"
            style={{ animationDelay: `${idx * 60}ms`, animationDuration: '300ms' }}>
            {renderRow(item, idx)}
          </tr>
        ))}
      </tbody>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Keep <tr>s in normal table flow (absolute positioning breaks <td>/<thead>
  // column alignment); simulate the off-screen rows with spacer rows instead.
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1]!.end : 0;

  return (
    <tbody ref={parentRef}>
      {paddingTop > 0 && (
        <tr aria-hidden="true">
          <td style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
        </tr>
      )}
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index]!;
        return (
          <tr
            key={rowKey(item)}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="border-b border-primary/10 hover:bg-secondary/10 transition-colors"
          >
            {renderRow(item, virtualRow.index)}
          </tr>
        );
      })}
      {paddingBottom > 0 && (
        <tr aria-hidden="true">
          <td style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} />
        </tr>
      )}
    </tbody>
  );
}
