// DockLandingPill — the fourth reading on the Launch Rail's manifest row:
// WHERE IN THE LINE this dispatch lands.
//
// The dock already answered WHERE it lands (the path), WHAT IT COSTS and IS IT
// READY. The one pre-flight fact it never showed is the one the operator asked
// about: whether pressing the button starts something now or adds a row to a
// line, and how long that line is.
//
// Shape and placement are the readout's own — the same pill the cost and ETA
// gauges use, in the same group, at the same reserved 30px row height. It
// renders in every state (a dash when the queue has not been read), so
// appearing and disappearing can never move the board above.
//
// What it is allowed to claim is decided in `dockLanding.ts`; read that file
// before changing a word here.

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { DockLanding } from './dockLanding';
import { DOCK_READING } from './dock/dockChrome';

export function DockLandingPill({ landing }: { landing: DockLanding }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;

  const { label, tip } = (() => {
    switch (landing.kind) {
      case 'room':
        return {
          label: m.grid_dock_landing_room,
          tip: tx(m.grid_dock_landing_tip_room, { running: landing.running, cap: landing.cap }),
        };
      case 'ahead':
        return {
          label: tx(m.grid_dock_landing_ahead, { count: landing.waiting }),
          tip: tx(m.grid_dock_landing_tip_ahead, { count: landing.waiting }),
        };
      case 'strict':
        return {
          label: tx(m.grid_dock_landing_wait, { position: landing.position }),
          tip: tx(m.grid_dock_landing_tip_strict, {
            count: landing.waiting,
            position: landing.position,
          }),
        };
      case 'wait':
        return {
          label: tx(m.grid_dock_landing_wait, { position: landing.position }),
          tip: tx(m.grid_dock_landing_tip_wait, { cap: landing.cap, position: landing.position }),
        };
      default:
        return { label: m.grid_dock_landing_unknown, tip: m.grid_dock_landing_tip_unknown };
    }
  })();

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <span>{tip}</span>
          <span className="typo-label text-primary">{m.grid_dock_landing_caveat}</span>
        </span>
      }
      placement="top"
    >
      <span className={DOCK_READING} aria-label={m.grid_dock_landing_aria} data-testid="quick-dispatch-landing">
        <span className="typo-data tabular-nums text-foreground">{label}</span>
      </span>
    </Tooltip>
  );
}

export default DockLandingPill;
