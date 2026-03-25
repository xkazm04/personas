import { useRef, useState, useEffect, type ReactNode } from 'react';

interface LazyChartProps {
  /** Estimated height for the placeholder skeleton (should match the chart card height). */
  height: number;
  children: ReactNode;
}

/**
 * Defers rendering of chart children until the wrapper scrolls into the viewport.
 * Uses IntersectionObserver with a 200px rootMargin so charts start rendering
 * just before they become visible, avoiding pop-in.
 */
export function LazyChart({ height, children }: LazyChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (visible) return <>{children}</>;

  return (
    <div
      ref={ref}
      className="bg-secondary/30 border border-primary/10 rounded-xl p-4"
    >
      <div className="mb-3">
        <div className="h-4 w-32 rounded bg-secondary/60" />
      </div>
      <div
        className="w-full rounded-lg bg-secondary/60 animate-pulse"
        style={{ height }}
      />
    </div>
  );
}
