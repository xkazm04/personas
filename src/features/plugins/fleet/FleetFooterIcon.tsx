import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetShipIcon } from './FleetShipIcon';
import { FleetFooterPopover } from './FleetFooterPopover';
import { FLEET_STATE_META, fleetStateCounts } from './fleetStateMeta';
import { isGridEligible } from './fleetSessionScope';

/** How many state chips fit beside the glyph before folding into "+N". */
const MAX_CHIPS = 3;

/**
 * Fleet status cluster in the desktop footer (DEV-only surface).
 *
 * Reads as one glance: the fleet mark, then a colored count chip per active
 * lifecycle state (attention-first order, so "awaiting input" is always
 * leftmost). The mark itself turns **violet and pulses** whenever any session
 * is blocked on a human — the one signal worth interrupting for, visible from
 * any page in the app.
 *
 * Click behaviour is deliberately state-dependent (see `handleClick`): with
 * live sessions it raises the grid *overlay* in place rather than navigating,
 * because the common case is a five-second check-and-reply, not "go do fleet
 * work". Navigation to the full page stays available in the hover popover.
 */
export default function FleetFooterIcon() {
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const gridOpen = useSystemStore((s) => s.fleetGridOpen);
  const setGridOpen = useSystemStore((s) => s.fleetSetGridOpen);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const { t, tx } = useTranslation();
  const [hovered, setHovered] = useState(false);

  const counts = useMemo(() => fleetStateCounts(sessions), [sessions]);
  // Only sessions that can host a tile decide whether the grid is worth
  // raising — the same predicate the overlay tiles by.
  const gridCount = useMemo(() => sessions.filter(isGridEligible).length, [sessions]);
  const needsYou = counts.awaiting_input;

  // Chips skip `exited`: a finished session is history, not a live state worth
  // a footer slot. The popover still tallies it.
  const active = useMemo(
    () => FLEET_STATE_META.filter((m) => m.id !== 'exited' && counts[m.id] > 0),
    [counts],
  );
  const chips = active.slice(0, MAX_CHIPS);
  const overflow = active.slice(MAX_CHIPS).reduce((sum, m) => sum + counts[m.id], 0);

  const openPage = useCallback(() => {
    setSidebarSection('plugins');
    setPluginTab('dev-tools');
    setDevToolsTab('fleet');
  }, [setSidebarSection, setPluginTab, setDevToolsTab]);

  // Grid open → close it. Sessions running → raise the overlay over whatever
  // page you're on. Nothing running → there is no grid to show, so send the
  // user to the page where sessions are spawned.
  const handleClick = useCallback(() => {
    if (gridOpen) setGridOpen(false);
    else if (gridCount > 0) setGridOpen(true);
    else openPage();
  }, [gridOpen, gridCount, setGridOpen, openPage]);

  const hint = gridOpen
    ? t.plugins.fleet.footer_hint_close_grid
    : gridCount > 0
      ? t.plugins.fleet.footer_hint_open_grid
      : t.plugins.fleet.footer_hint_open_page;

  const label = needsYou > 0
    ? (needsYou === 1
        ? tx(t.plugins.fleet.footer_needs_you_one, { count: needsYou })
        : tx(t.plugins.fleet.footer_needs_you_other, { count: needsYou }))
    : `${t.plugins.fleet.footer_title} — ${hint}`;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={handleClick}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        data-testid="footer-fleet-toggle"
        aria-label={label}
        title={label}
        className={`h-7 pl-1.5 pr-1 rounded-input flex items-center gap-1.5 transition-colors ${
          needsYou > 0
            ? 'text-violet-300 bg-violet-500/15 hover:bg-violet-500/25'
            : gridOpen
              ? 'text-primary bg-primary/10 hover:bg-primary/15'
              : 'text-foreground hover:text-foreground hover:bg-secondary/50'
        } ${gridOpen ? 'ring-1 ring-primary/30' : ''}`}
      >
        <span className="relative flex items-center">
          <FleetShipIcon className="w-5 h-5" />
          {needsYou > 0 && (
            <span
              className="absolute inset-0 rounded-full bg-violet-400/25 animate-ping motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
        </span>
        {chips.length > 0 && (
          <span className="flex items-center gap-1" data-testid="footer-fleet-counts">
            {chips.map((m) => (
              <span
                key={m.id}
                data-testid={`footer-fleet-chip-${m.id}`}
                className={`min-w-[15px] px-1 py-0.5 rounded-full text-[10px] font-semibold leading-none tabular-nums text-center ${m.chip} ${m.text}`}
              >
                {counts[m.id]}
              </span>
            ))}
            {overflow > 0 && (
              <span
                data-testid="footer-fleet-chip-overflow"
                className="min-w-[15px] px-1 py-0.5 rounded-full bg-secondary/60 text-[10px] font-semibold leading-none tabular-nums text-center text-foreground"
              >
                {`+${overflow}`}
              </span>
            )}
          </span>
        )}
      </button>

      {hovered && (
        <FleetFooterPopover
          counts={counts}
          total={sessions.length}
          hint={hint}
          onOpenPage={openPage}
        />
      )}
    </div>
  );
}
