// UsageStripShell — the usage strip's chrome, with nothing in it.
//
// Two jobs. It is the Suspense fallback while `UsageStrip`'s own chunk loads
// (the strip carries the confirm dialog, the toggle, the async buttons — none
// of which belong in the board's opening commit), and it is the frame the
// loaded strip renders into, so the swap moves nothing.
//
// The frame is two rows:
//   1. HEADER — the label and the plan count on the left; the auto-rotate
//      controls, then the refresh control and its "as of" stamp, on the
//      right. Under a subtle border. (The controls used to be portaled into
//      the Activity card's header; they belong to the strip they act on.)
//   2. SLOTS — five equal columns, one per plan. A plan is a small card:
//      its account on top, its two meters beneath. One stored plan fills one
//      slot; the operator adds the next four one at a time. Empty slots stay
//      empty and keep their width, so a plan never stretches to a width it
//      will not have once its neighbours arrive. The active plan's card is
//      highlighted; the account name is INSIDE the card, aligned with its own
//      meters, which is what a column layout is for.

import type { ReactNode } from 'react';
import { Gauge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/** The strip is designed for this many plans; more would need a second row. */
export const PLAN_SLOTS = 5;

/** The five-column slot grid. */
export const SLOT_GRID = 'grid grid-cols-5 gap-2';

/** One plan card's meter row: time-left label · meter · percent · pace. */
export const METER_GRID = 'grid grid-cols-[2rem_minmax(0,1fr)_2.25rem_0.875rem] items-center gap-x-1.5';

export function StripFrame({
  planCount, titleRight, controls, tabs, bare = false, children,
}: {
  /** Stored plans, shown as "n/5 plans" beside the title; hidden while none is stored. */
  planCount?: number;
  /** Far right of the header row — refresh + stamp. */
  titleRight?: ReactNode;
  /** Right side of the header row, before `titleRight` — the auto-rotate controls. */
  controls?: ReactNode;
  /** The layout switcher, after the plan count. The chunk fallback has none. */
  tabs?: ReactNode;
  /** A variant body lays itself out: skip the five-slot grid and its padding. */
  bare?: boolean;
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
      {/* h-10, not h-7: the row now seats the layout switcher (a `sm`
          SegmentedTabs is ~37px). The height is FIXED and shared with the chunk
          fallback, which has no tabs, so the fallback → strip swap still moves
          nothing. */}
      <div className="flex h-10 items-center gap-2 border-b border-border/60 px-3 typo-caption text-foreground">
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
        {tabs && <span className="flex-shrink-0">{tabs}</span>}
        <span className="ml-auto inline-flex min-w-0 items-center gap-3">
          {controls}
          <span className="inline-flex flex-shrink-0 items-center gap-1 opacity-70">
            {titleRight}
          </span>
        </span>
      </div>
      {bare ? children : <div className={`${SLOT_GRID} px-3 py-1.5`}>{children}</div>}
    </div>
  );
}

/**
 * One slot's chrome: the card border, an optional header line, the rows.
 *
 * A RECEDED CARD IS THE DEFAULT, not the exception. The strip answers one
 * question at a glance — *how much of the plan I am billing to right now is
 * left* — and five equally-bright cards make the eye do the work of finding
 * which one that is. So every card that is not the live login sits back at half
 * opacity and comes to full on hover or on keyboard focus; the active card
 * never recedes. This used to dim only a quarantined plan, which meant the four
 * cards competing hardest with the answer were the four in perfect health.
 *
 * `focus-within`, not just `hover`: a card's Switch and Forget controls are
 * reachable by tab, and a control that is only legible under a pointer is not
 * a smaller feature — it is an inoperable one for anyone not using one.
 */
export function PlanCard({
  header, active = false, recede = false, children, ...rest
}: {
  header: ReactNode;
  active?: boolean;
  /** Not the live login — sit back until looked at. */
  recede?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-input border px-2 py-1 transition-opacity ${
        active ? 'border-primary/40 bg-primary/10' : 'border-border/60 bg-foreground/[0.015]'
      } ${recede ? 'opacity-50 hover:opacity-100 focus-within:opacity-100' : ''}`}
      {...rest}
    >
      <div className="flex h-4 min-w-0 items-center gap-1 typo-caption">{header}</div>
      {children}
    </div>
  );
}

/** A ghost card: header bar + two meter silhouettes. */
export function GhostCard() {
  const bar = 'rounded bg-primary/[0.06]';
  return (
    <div
      aria-hidden
      className="flex min-w-0 flex-col gap-1 rounded-input border border-border/60 bg-foreground/[0.015] px-2 py-1 animate-fade-in"
      style={{ animationDelay: '150ms' }}
    >
      <div className="flex h-4 items-center typo-caption">
        <span className={`h-[0.7em] w-28 ${bar}`} />
      </div>
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

/** The slots that hold no plan: present, empty, the same width. */
export function EmptySlots({ from }: { from: number }) {
  return (
    <>
      {Array.from({ length: Math.max(0, PLAN_SLOTS - from) }, (_, i) => (
        <div
          key={from + i}
          aria-hidden
          className="rounded-input border border-dashed border-border/40"
          data-testid="fleet-usage-empty-slot"
        />
      ))}
    </>
  );
}

/** The chunk fallback: frame + one ghost card + four empty slots. */
export function UsageStripFallback() {
  return (
    <StripFrame>
      <GhostCard />
      <EmptySlots from={1} />
    </StripFrame>
  );
}

export default UsageStripFallback;
