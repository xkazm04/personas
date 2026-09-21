// UsageStripShell — the usage strip's chrome, with nothing in it.
//
// Two jobs. It is the Suspense fallback while `UsageStrip`'s own chunk loads
// (the strip carries the confirm dialog, the toggle, the async buttons — none
// of which belong in the board's opening commit), and it is the frame the
// loaded strip renders into, so the swap moves nothing.
//
// The frame is two parts:
//   1. HEADER — the label and the stored-plan count on the left; the
//      auto-rotate controls, then the refresh control and its "as of" stamp, on
//      the right. Under a subtle border. It is permanent: it renders before the
//      first read, during it and after it.
//   2. ROWS — ONE 28px ROW PER ACCOUNT, across every provider, flowing in an
//      auto-fill grid (`ROW_GRID`): as many 400px-minimum columns (the email needs ~200px beside the fixed icon + two clusters) as the width
//      allows, so one account and eight both stay compact and the strip never
//      scrolls sideways. A row is a single line — provider mark, account, the
//      5-hour cluster, the 7-day cluster — and its bottom edge IS the 7-day
//      meter (`AccountRows`). There are no cards and no slots: a row that does
//      not exist takes no room.

import type { ReactNode } from 'react';
import { Gauge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/** The stored-plan count the header chip is read against ("n/5 plans"). A design number, not a backend cap: the rows themselves have no slot limit. */
export const PLAN_SLOTS = 5;

/**
 * The row grid: FIVE accounts per strip row, a sixth wraps. Each column's floor
 * is a fifth of the strip (`(100% − 4 gaps) / 5`), so exactly five fit at any
 * normal width; the 14rem floor under it lets a narrow window drop to fewer
 * columns instead of scrolling sideways. Rows are exactly 28px.
 */
export const ROW_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(max(14rem,calc((100%_-_4rem)/5)),1fr))] auto-rows-[1.75rem] gap-x-4 gap-y-1';

/** One row's box — shared by the real row and its ghost so the swap moves nothing. */
export const ROW_BOX = 'relative flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-input px-1.5';

/** The live account's cell: a subtle success wash, so it is found at a glance. */
export const ROW_ACTIVE = 'bg-status-success/10';

/**
 * Every other cell — standby plans, read-only providers, empty providers, the
 * loading ghosts: a subtle black wash, so the content sits IN something rather
 * than floating on the strip.
 */
export const ROW_REST = 'bg-black/20';

export function StripFrame({
  planCount, titleRight, controls, children,
}: {
  /** Stored plans, shown as "n/5 plans" beside the title; hidden while none is stored. */
  planCount?: number;
  /** Far right of the header row — refresh + stamp. */
  titleRight?: ReactNode;
  /** Right side of the header row, before `titleRight` — the auto-rotate controls. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  const { t, tx } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t.monitor.usage_aria}
      data-testid="fleet-usage-strip"
      className="flex flex-shrink-0 flex-col border-b border-border bg-foreground/[0.01]"
    >
      <div className="flex h-7 items-center gap-2 border-b border-border/60 px-3 typo-caption text-foreground">
        <span className="inline-flex flex-shrink-0 items-center gap-1.5 uppercase tracking-wider opacity-70">
          <Gauge className="h-3 w-3" aria-hidden />
          {t.monitor.usage_title}
        </span>
        {planCount !== undefined && planCount > 0 && (
          <span
            className="inline-flex flex-shrink-0 items-center rounded-full border border-border bg-secondary/20 px-2 py-0.5 tabular-nums"
            data-testid="fleet-usage-plan-count"
          >
            {tx(t.monitor.usage_plan_count, { count: planCount, max: PLAN_SLOTS })}
          </span>
        )}
        <span className="ml-auto inline-flex min-w-0 items-center gap-3">
          {controls}
          <span className="inline-flex flex-shrink-0 items-center gap-1 opacity-70">
            {titleRight}
          </span>
        </span>
      </div>
      <div className={`${ROW_GRID} px-3 py-1.5`}>{children}</div>
    </div>
  );
}

/**
 * A ghost row: the real row's geometry — mark, name, two clusters, the bottom
 * track — with nothing in it. Static (no pulse, no spinner) and faded in late,
 * so a warm strip never shows it.
 */
export function GhostRow() {
  const bar = 'h-[0.7em] rounded bg-primary/[0.06]';
  return (
    <div
      aria-hidden
      className={`${ROW_BOX} ${ROW_REST} animate-fade-in typo-body`}
      style={{ animationDelay: '150ms' }}
      data-testid="fleet-usage-ghost-row"
    >
      <span className="h-4 w-4 flex-shrink-0 rounded-interactive bg-primary/[0.06]" />
      <span className={`min-w-0 flex-1 ${bar}`} />
      <span className={`w-14 flex-shrink-0 ${bar}`} />
      <span className={`w-14 flex-shrink-0 ${bar}`} />
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-border/40" />
    </div>
  );
}

/** The chunk fallback: the frame and one ghost row. */
export function UsageStripFallback() {
  return (
    <StripFrame>
      <GhostRow />
    </StripFrame>
  );
}

export default UsageStripFallback;
