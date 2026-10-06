// DockParts — the dispatch dock's readings, and its one bit of shell chrome.
//
// The dock's module header records what the readout EARNED in a blind contest:
// firing an agent at a real repository is a pre-flight act, so the console
// answers WHERE this lands, WHAT IT COSTS, IS IT READY and WHERE IN THE LINE
// before the operator commits. Three shells rearranged those four readings
// until 2026-10-06; none was allowed to drop one, which is why they live here
// as one component instead of being re-authored per shell. The operator kept
// `console` and the other two shells went, along with the switch and the
// panel declaration that paired with it — this file hosted the tree's other
// compliant `SegmentedTabs` site, and with no tablist left there is no panel
// to declare.
//
// Every pill is the same chrome at the same 20px content height, and the group
// is always fully mounted — a reading that appeared or vanished would move the
// row it sits in, and the row it sits in is at the bottom of a live board.

import { ChevronDown } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { DockLandingPill } from '../DockLandingPill';
import { formatEstimateCost, formatEstimateMinutes } from '../dockEstimate';
import type { DockConsole } from './useDockConsole';

/** One column, centred — the dock's content never spreads past this. */
export const DOCK_COLUMN = 'mx-auto w-full max-w-[800px]';

/** The readout's shared pill chrome: one border, one fill, one height. */
const PILL =
  "typo-code flex items-center gap-1 whitespace-nowrap rounded-pill border border-card-border bg-card-bg px-2 py-0.5 text-muted [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50";

/**
 * WHAT IT COSTS · IS IT READY · WHERE IN THE LINE — the three readings that
 * travel together. `armed` gates the figures: the console must not quote a
 * price for a run the launch button would refuse.
 */
export function DockReadout({ console: d }: { console: DockConsole }) {
  const { c, armed, estimate, landing } = d;
  return (
    <span className="flex flex-shrink-0 items-center gap-1.5" data-testid="quick-dispatch-readout">
      <Tooltip
        content={
          <span className="flex flex-col gap-0.5">
            <span>{c.quickT.estimate_cost_label}</span>
            <span className="typo-label text-primary">
              {estimate.assumedModel ? c.quickT.estimate_assumed_model : c.quickT.estimate_disclaimer}
            </span>
          </span>
        }
        placement="top"
      >
        <span className={PILL} data-testid="quick-dispatch-gauge-cost">
          ≈
          <b className="font-semibold tabular-nums text-foreground">
            {armed ? formatEstimateCost(estimate.cost) : '—'}
          </b>
        </span>
      </Tooltip>
      <Tooltip content={c.quickT.estimate_eta_label} placement="top">
        <span className={PILL} data-testid="quick-dispatch-gauge-eta">
          ~
          <b className="font-semibold tabular-nums text-foreground">
            {armed ? formatEstimateMinutes(estimate.minutes) : '—'}
          </b>
        </span>
      </Tooltip>
      <span
        className={`typo-label whitespace-nowrap rounded-pill border px-2 py-0.5 ${
          armed
            ? 'border-status-success/45 bg-status-success/10 text-status-success'
            : `border-card-border bg-card-bg text-muted [[data-theme^='light']_&]:border-primary/35 [[data-theme^='light']_&]:bg-secondary/50`
        }`}
        data-testid="quick-dispatch-status-pill"
      >
        {armed ? c.quickT.status_armed : c.quickT.status_standby}
      </span>
      <DockLandingPill landing={landing} />
    </span>
  );
}

/**
 * WHERE this lands — the absolute target path, or the placeholder until a
 * project is chosen. `dir="rtl"` on the box with an `ltr` span inside is what
 * truncates a long path from the LEFT, so the leaf stays readable.
 */
export function DockTarget({ console: d, className = '' }: { console: DockConsole; className?: string }) {
  const { c } = d;
  return (
    <span
      className={`min-w-0 flex-1 truncate text-right font-mono text-xs ${
        c.projectChip ? 'text-foreground' : 'text-muted'
      } ${className}`}
      dir="rtl"
      data-testid="quick-dispatch-target"
    >
      <span dir="ltr" style={{ unicodeBidi: 'embed' }}>
        {c.projectChip ? c.projectChip.root_path : c.quickT.placeholder}
      </span>
    </span>
  );
}

/** Back to the resting row. The shared `Button`, like every other control here. */
export function DockCollapse({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={t.monitor.grid_dock_collapse}
      data-testid="quick-dispatch-dock-collapse"
      className="h-6 w-6 flex-shrink-0 text-muted hover:text-foreground"
    >
      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
    </Button>
  );
}
