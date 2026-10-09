// PROTOTYPE ROUND (spark council-readout), direction C. The panel's own
// width, so the table picks its column set from the room it was given rather
// than from the viewport (the stage hands it ~46% at 1920, ~52% at 1280).
import { useLayoutEffect, useState, type RefObject } from 'react';

export function useBoxWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
