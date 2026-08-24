// DeferredPanel — deeper lazy mount for the Analytics tab's below-the-fold
// panels (loading-pattern v2 §1/§3). The wrapped panel (a `React.lazy` chunk)
// parses + mounts — and therefore fires its data fetches — only when its
// placeholder scrolls into view, or on the first idle beat, whichever comes
// first. The placeholder and the Suspense fallback are the same calm,
// geometry-matched ghost in the panels' own section chrome (never a spinner —
// the spinner boundary bans spinners for surfaces).
import { Suspense, useEffect, useState, type ReactNode } from 'react';

import { useElementVisible } from '@/hooks/utility/useElementVisible';

/** Idle-mount deadline (ms) — panels warm up shortly after first paint even
 *  when they never scroll into view, so the tab's data is fresh on arrival. */
const IDLE_TIMEOUT_MS = 2500;

function PanelGhost({ minHeightClass, bare }: { minHeightClass: string; bare: boolean }) {
  if (bare) return <div aria-hidden="true" className="h-px" />;
  return (
    <div
      aria-hidden="true"
      className={`rounded-card border border-primary/12 bg-secondary/[0.12] animate-fade-in ${minHeightClass}`}
      style={{ animationDelay: '150ms' }}
    />
  );
}

export function DeferredPanel({ children, minHeightClass = 'min-h-12', bare = false }: {
  children: ReactNode;
  /** Placeholder height — size roughly to the incoming panel's header band. */
  minHeightClass?: string;
  /** Invisible placeholder — for panels that render null when they have no
   *  data, so no ghost flashes for a panel that may never appear. */
  bare?: boolean;
}) {
  const [ref, visible] = useElementVisible<HTMLDivElement>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    if (visible) { setMounted(true); return; }
    // One-shot idle fallback for panels sitting below the fold.
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setMounted(true), { timeout: IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(() => setMounted(true), IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [visible, mounted]);

  if (!mounted) {
    return <div ref={ref}><PanelGhost minHeightClass={minHeightClass} bare={bare} /></div>;
  }
  return <Suspense fallback={<PanelGhost minHeightClass={minHeightClass} bare={bare} />}>{children}</Suspense>;
}
