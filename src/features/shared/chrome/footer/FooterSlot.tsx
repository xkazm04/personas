import { Suspense, type ReactNode } from 'react';

/** Hairline separator between footer icons. */
export function FooterDivider() {
  return <div className="w-px h-4 bg-primary/10" />;
}

/**
 * Suspense boundary for one lazily loaded footer child.
 *
 * `reserve` holds the 28px icon footprint while the chunk loads so the
 * clusters do not shift sideways as icons arrive. Children that are often
 * absent (resume-tour, onboarding replay, recorder pill) pass `reserve={false}`
 * so a cold load never paints a gap that then collapses.
 */
export function FooterSlot({ children, reserve = true }: { children: ReactNode; reserve?: boolean }) {
  return (
    <Suspense fallback={reserve ? <span className="w-7 h-7" aria-hidden="true" /> : null}>
      {children}
    </Suspense>
  );
}
