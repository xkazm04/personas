// UsageStripShell — the usage strip's chrome, with nothing in it.
//
// Two jobs. It is the Suspense fallback while `UsageStrip`'s own chunk loads
// (the strip carries the confirm dialog, the toggle, the async buttons — none
// of which belong in the board's opening commit), and it is the frame the
// loaded strip renders into, so the swap moves nothing. Same geometry, same
// borders, same rows; the loaded strip fills the slots.
//
// The frame is three rows:
//   1. TITLE — the label, and the account the CLI is signed in as, under a
//      subtle border. The one line that says whose usage this is.
//   2. CONTROLS — refresh, auto-rotate, the last rotation. Under the title,
//      not off to the right, so the meters keep the full width.
//   3. BODY — the meter rows (one login) or the plan rows (several).

import type { ReactNode } from 'react';
import { Gauge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/** The single-login meter grid: label · meter · percent · pace. */
export const METER_GRID = 'grid grid-cols-[2.5rem_minmax(6rem,1fr)_2.5rem_1rem] items-center gap-x-2';

export function StripFrame({
  email, titleExtra, controls, children,
}: {
  /** The signed-in account, or null while unknown. */
  email: string | null;
  /** Rides beside the email — e.g. "not stored · Store". */
  titleExtra?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t.monitor.usage_aria}
      data-testid="fleet-usage-strip"
      className="flex flex-shrink-0 flex-col border-b border-border bg-foreground/[0.01]"
    >
      <div className="flex h-6 items-center gap-2 border-b border-border/60 px-3">
        <span className="inline-flex flex-shrink-0 items-center gap-1.5 typo-caption uppercase tracking-wider text-foreground opacity-70">
          <Gauge className="h-3 w-3" aria-hidden />
          {t.monitor.usage_title}
        </span>
        <span className="min-w-0 truncate typo-caption text-foreground" data-testid="fleet-usage-live-email">
          {email ?? <span className="inline-block h-[0.7em] w-32 rounded bg-primary/[0.06] align-middle" aria-hidden />}
        </span>
        {titleExtra}
      </div>
      {controls && (
        <div className="flex h-6 items-center gap-3 px-3 typo-caption text-foreground">
          {controls}
        </div>
      )}
      <div className="px-3 py-1.5">{children}</div>
    </div>
  );
}

/** Two static meter silhouettes, for the first read of the session. */
export function GhostRows() {
  const bar = 'rounded bg-primary/[0.06]';
  return (
    <div aria-hidden className="flex flex-col gap-1 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[0, 1].map((i) => (
        <div key={i} className={`${METER_GRID} h-4`}>
          <span className={`h-[0.7em] w-5 ${bar} typo-caption`} />
          <span className="h-2 w-full rounded-full bg-foreground/10" />
          <span className={`h-[0.7em] w-full ${bar} typo-caption`} />
          <span />
        </div>
      ))}
    </div>
  );
}

/** The chunk fallback: frame + ghost rows, no controls yet. */
export function UsageStripFallback() {
  return (
    <StripFrame email={null}>
      <GhostRows />
    </StripFrame>
  );
}

export default UsageStripFallback;
