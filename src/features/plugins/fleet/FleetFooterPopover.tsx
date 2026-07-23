import { ExternalLink } from 'lucide-react';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import { useTranslation } from '@/i18n/useTranslation';
import { FLEET_STATE_META } from './fleetStateMeta';

interface FleetFooterPopoverProps {
  counts: Record<FleetSessionState, number>;
  /** Total tracked sessions (all states, including exited). */
  total: number;
  /** What a click on the icon will do right now — shown as the footer hint. */
  hint: string;
  /** Jump to the full Fleet page (Dev Tools → Fleet). */
  onOpenPage: () => void;
}

/**
 * Hover breakdown for the footer fleet cluster.
 *
 * The cluster itself only has room for the top few states, so this is where
 * the complete tally lives — every non-zero state, exited included (the chips
 * deliberately drop exited: a finished session isn't something to triage, but
 * it is something you may want to account for).
 *
 * It also carries the escape hatch the icon click no longer offers: with live
 * sessions the icon opens the grid overlay in place, so "take me to the actual
 * Fleet page" needs its own affordance.
 */
export function FleetFooterPopover({ counts, total, hint, onOpenPage }: FleetFooterPopoverProps) {
  const { t, tx } = useTranslation();
  const rows = FLEET_STATE_META.filter((m) => counts[m.id] > 0);

  return (
    <div
      data-testid="footer-fleet-popover"
      role="tooltip"
      className="animate-fade-slide-in absolute bottom-full right-0 mb-2 w-56 rounded-card border border-primary/15 bg-background shadow-elevation-3 p-2 z-50"
    >
      <div className="flex items-baseline justify-between gap-2 px-1 pb-1.5 mb-1 border-b border-primary/10">
        <p className="typo-label text-foreground">{t.plugins.fleet.footer_title}</p>
        <p className="text-[10px] text-foreground tabular-nums">
          {total === 1
            ? tx(t.plugins.fleet.sessions_one, { count: total })
            : tx(t.plugins.fleet.sessions_other, { count: total })}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-1 py-2 text-[11px] text-foreground">{t.plugins.fleet.footer_empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((m) => (
            <li
              key={m.id}
              data-testid={`footer-fleet-row-${m.id}`}
              className="flex items-center gap-2 px-1 py-0.5 rounded-input"
            >
              <span className={`h-2 w-2 rounded-full flex-shrink-0 ${m.dot}`} aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-[11px] text-foreground">
                {t.plugins.fleet[m.labelKey]}
              </span>
              <span className={`text-[11px] font-semibold tabular-nums ${m.text}`}>{counts[m.id]}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-1 pt-1 border-t border-primary/10">
        <button
          type="button"
          data-testid="footer-fleet-open-page"
          onClick={onOpenPage}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-input text-[11px] text-foreground hover:bg-secondary/40 transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          {t.plugins.fleet.footer_open_page}
        </button>
        <p className="px-2 pb-0.5 text-center text-[10px] text-foreground">{hint}</p>
      </div>
    </div>
  );
}
