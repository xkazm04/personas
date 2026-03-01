import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export function useVirtualList<T>(items: T[], estimateSize = 56) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 5,
  });
  return { parentRef, virtualizer } as const;
}
