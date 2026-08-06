// Row key → the surface that opens for it. ONE decision, for every entry point.
//
// This existed twice. `ImproveCell` (the Passport wall's Compare table and the
// Mastermind project sidebar) had the full ladder — skills workbench, database
// modal, monitoring modal, data-links popover, standards popover, deploy
// popover. The Mastermind CANVAS had its own copy inside MastermindPage:
//
//     {improvePopup && (improvePopup.standards ? <ImprovePopover/> : <DeployPopover/>)}
//
// …which knew only the last two branches. So every dimension added to the
// ladder was reachable from the wall and silently NOT reachable from the
// canvas: clicking Database or Monitoring on an island opened the generic
// deploy popover, and the new modal never mounted at all. The bug is not that
// the canvas routed to the wrong surface — it is that the canvas had a second
// router, and a second router drifts by construction.
//
// Both call sites now render this. Adding a dimension means adding one branch
// here and nothing anywhere else.
import type { AppPassport } from '../passportModel';
import { useImprove } from './ImproveContext';
import { ImprovePopover } from './ImprovePopover';
import { DeployPopover } from './DeployPopover';
import { SkillsWorkbench } from './SkillsWorkbench';
import { DataLinksPopover } from './DataLinksPopover';
import { DatabaseModal } from './DatabaseModal';
import { MonitoringModal } from './MonitoringModal';
import { DATABASE_DIMENSION, MONITORING_DIMENSION, STANDARDS_ROWS } from './improveRows';

export { DATABASE_DIMENSION, MODAL_ROWS, MONITORING_DIMENSION, STANDARDS_ROWS } from './improveRows';

export function ImproveSurface({ slug, rowKey, passport, anchor, onClose }: {
  slug: string;
  rowKey: string;
  passport: AppPassport;
  /** Anchor for the popover branches. Modals ignore it. */
  anchor: DOMRect | null;
  onClose: () => void;
}) {
  const engine = useImprove();
  const projectName = engine?.getRaw(slug)?.project.name ?? slug;

  if (rowKey === 'skills') {
    return <SkillsWorkbench slug={slug} initialMode="manage" onClose={onClose} />;
  }
  if (rowKey === DATABASE_DIMENSION) {
    return <DatabaseModal slug={slug} projectName={projectName} passport={passport} onClose={onClose} />;
  }
  if (rowKey === MONITORING_DIMENSION) {
    return <MonitoringModal slug={slug} projectName={projectName} passport={passport} onClose={onClose} />;
  }
  if (rowKey === 'datalinks') {
    return <DataLinksPopover slug={slug} anchor={anchor} onClose={onClose} />;
  }
  if (STANDARDS_ROWS.has(rowKey)) {
    return <ImprovePopover slug={slug} rowKey={rowKey} anchor={anchor} onClose={onClose} />;
  }
  return <DeployPopover slug={slug} rowKey={rowKey} anchor={anchor} onClose={onClose} />;
}
