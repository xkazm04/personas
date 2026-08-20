// "What is this workspace trying to ship right now?" — as canvas chrome.
//
// The per-island ship chip (IslandBanner) already answers that PER PROJECT, but
// only if you are looking at that island, only at a zoom where you can read it,
// and only for the island your eye happens to be on. On a portfolio canvas the
// question is usually the other way round: there is one milestone actually in
// flight and the operator wants to get to it, not hunt for the island that owns
// it.
//
// So this is a single line above the mode toolbar, and it names ONE milestone:
//
//   · the focused project's, when the operator has focused one (opened its
//     sidebar, or Athena composed a panel for it) — following the subject he
//     has already chosen is never surprising;
//   · otherwise the most urgent one across the whole workspace, by the same
//     ordering the canvas uses everywhere else: worst first. Late before
//     on-track, cut before merely planned, nearest date before farthest.
//
// Clicking it opens that project's Ship tab. It renders NOTHING when no project
// has an open milestone, so a workspace with nothing in flight carries no
// added chrome — the same rule DataHealthBar follows.
import { ChevronRight, Flag } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { INK } from '../../sub_factory/passport/passportInk';
import type { Island } from './types';

/** One project's open milestone, flattened for ranking. */
export interface MilestoneStatusEntry {
  slug: string;
  projectName: string;
  name: string;
  status: 'active' | 'planned';
  shipped: number;
  total: number;
  /** The milestone's own target date, when set. */
  targetDate: string | null;
  /** Velocity forecast, when the project's history supports one. */
  forecastDate: string | null;
  late: boolean;
}

/** Islands → the ranked list of open milestones. Exported for the test. */
export function openMilestones(islands: Island[]): MilestoneStatusEntry[] {
  const rows: MilestoneStatusEntry[] = [];
  for (const i of islands) {
    const s = i.ship;
    // `next === null` means everything is shipped; `nextStatus === null` means
    // the project has no milestones at all. Neither is an open milestone, and
    // neither is a problem worth a line of chrome.
    if (!s || !s.next || !s.nextStatus) continue;
    rows.push({
      slug: i.slug,
      projectName: i.name,
      name: s.next,
      status: s.nextStatus,
      shipped: s.shipped,
      total: s.total,
      targetDate: s.targetDate,
      forecastDate: s.forecastDate,
      late: s.late,
    });
  }
  return rows.sort((a, b) => {
    if (a.late !== b.late) return a.late ? -1 : 1;
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    // A dated milestone outranks an undated one: a date is a commitment, and
    // the undated ones are exactly the ones nobody is counting down to.
    const ad = a.targetDate ?? a.forecastDate;
    const bd = b.targetDate ?? b.forecastDate;
    if (ad && bd) return ad.localeCompare(bd);
    if (ad !== bd) return ad ? -1 : 1;
    // Stable, so the bar does not reshuffle between renders on a tie.
    return a.slug.localeCompare(b.slug);
  });
}

export function MilestoneStatusBar({ islands, focusedSlug, onOpenShip }: {
  islands: Island[];
  /** The project the operator is already looking at, when there is one. */
  focusedSlug: string | null;
  onOpenShip: (slug: string) => void;
}) {
  const { t, tx } = useTranslation();
  const rows = openMilestones(islands);
  const row = (focusedSlug ? rows.find((r) => r.slug === focusedSlug) : undefined) ?? rows[0];
  if (!row) return null;

  const hue = row.late ? 'var(--status-warning)' : row.status === 'active' ? INK.teal : 'var(--muted-foreground)';
  const date = row.targetDate ?? row.forecastDate;
  // Two different claims, and conflating them would be dishonest: a target date
  // is what someone COMMITTED to; a forecast is what this project's own
  // cut-to-ship history predicts. The label says which one is on screen.
  const dateLabel = row.targetDate
    ? tx(t.mastermind.milestone_bar_target, { date: row.targetDate })
    : row.forecastDate
      ? tx(t.mastermind.milestone_bar_forecast, { date: row.forecastDate })
      : null;

  return (
    <Tooltip
      content={tx(t.mastermind.milestone_bar_tooltip, { project: row.projectName })}
      placement="top"
    >
      <button
        type="button"
        onClick={() => onOpenShip(row.slug)}
        className="group/msbar inline-flex items-center gap-2 max-w-[min(38rem,calc(100vw-8rem))] px-3 py-1.5 rounded-interactive mm-chrome surface-blur-tooltip transition-colors hover:bg-primary/10 focus-ring"
        data-testid="mm-milestone-bar"
      >
        <Flag className="w-3.5 h-3.5 shrink-0" style={{ color: hue }} aria-hidden />
        <span className="typo-caption text-foreground/70 shrink-0 truncate max-w-[10rem]">{row.projectName}</span>
        <span className="w-px h-3 bg-foreground/[0.15] shrink-0" aria-hidden />
        <span className="typo-caption text-foreground font-medium truncate min-w-0">{row.name}</span>
        <span className="typo-caption tabular-nums shrink-0" style={{ color: hue }}>
          {row.status === 'active' ? t.mastermind.milestone_bar_cut : t.mastermind.milestone_bar_planned}
        </span>
        <span className="typo-caption tabular-nums text-foreground/70 shrink-0">
          {tx(t.ship.cover_shipped_count, { shipped: row.shipped, total: row.total })}
        </span>
        {date && dateLabel && (
          <span className="typo-caption tabular-nums shrink-0" style={{ color: row.late ? 'var(--status-warning)' : undefined }}>
            {dateLabel}
          </span>
        )}
        <ChevronRight className="w-3.5 h-3.5 shrink-0 text-primary/60 opacity-0 group-hover/msbar:opacity-100 transition-opacity" aria-hidden />
      </button>
    </Tooltip>
  );
}
