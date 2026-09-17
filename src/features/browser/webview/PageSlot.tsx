/**
 * The hole in the React tree where the real page goes.
 *
 * The embedded page is a SEPARATE OS WINDOW owned by `main` and drawn ABOVE
 * everything React paints. Nothing may overlay this rectangle — not a modal,
 * not a toast, not a tooltip — because whatever we paint there is simply
 * invisible. What this component does is measure itself and tell Rust where
 * the rectangle is, in LOGICAL pixels relative to the main window's client
 * area, which is exactly what `getBoundingClientRect()` reports.
 *
 * It re-measures on its own resize (ResizeObserver), on window resize, and on
 * scroll — a sidebar opening, a panel collapsing and a window move all change
 * the rectangle without changing this element's size.
 */
import { useEffect, useRef } from 'react';

import * as browserApi from '@/api/browser';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

interface PageSlotProps {
  /** False when no tab is open — the slot then paints its own idle copy. */
  hasTab: boolean;
}

export default function PageSlot({ hasTab }: PageSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastRect = useRef('');
  const { t } = useTranslation();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      // Skip a no-op round trip: this fires on every scroll frame, and moving
      // a window is not free on Windows.
      const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
      if (key === lastRect.current) return;
      lastRect.current = key;
      browserApi
        .setViewport({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        .catch(silentCatch('browser set viewport'));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-testid="webview-slot"
      className="flex-1 min-h-0 min-w-0 rounded-card border border-primary/10 bg-background/40 overflow-hidden"
    >
      {/* Only ever visible when no page covers the slot. A page IS covering it
          whenever a tab is open, so this copy is not competing with anything. */}
      {!hasTab && (
        <div className="h-full w-full flex items-center justify-center p-6 text-center">
          <p className="typo-body text-foreground max-w-sm">{t.browser.webview.slot_idle}</p>
        </div>
      )}
    </div>
  );
}
