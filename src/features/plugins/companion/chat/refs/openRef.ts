/**
 * openRef — where a reference link goes.
 *
 * One dispatcher for every surface that renders Athena's prose (the Current
 * bubble, the prototypes' exchange transcript and frame top), so a link of a
 * given kind always lands in the same place. The prototypes own two targets
 * differently (their work items open in layer two, and a report is a layer-two
 * view rather than an overlay), which is what `RefOpenerOverrides` carries.
 */

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../../companionStore';
import { openGoalsBoard } from '../../guidance/appActions';
import { brainKindOfId } from '../../parseBrainLinks';
import type { RefKind } from './refGrammar';

export interface RefOpenerOverrides {
  /** Prototypes: open a `useWorkforce` item (`approval:<id>`, `card:<id>`, `decision:<id>`) in layer two. */
  openWork?: (workItemId: string) => void;
  /** Prototypes: open a report as the layer-two `report` view. */
  openReport?: (reportId: string) => void;
}

/** Scroll the Current layout to a proposal stack, falling back to the other one. */
function jumpToStack(preferred: 'approvals' | 'chat-cards'): boolean {
  const store = useCompanionStore.getState();
  const has = { approvals: store.approvals.length > 0, 'chat-cards': store.chatCards.length > 0 };
  const other = preferred === 'approvals' ? 'chat-cards' : 'approvals';
  // Same rule as `AthenaChatBody.handleJumpSummary`: by click time the item may
  // have moved stacks or resolved; land where there is content, or nowhere.
  const target = has[preferred] ? preferred : has[other] ? other : null;
  if (!target) return false;
  const el = document.querySelector(`[data-companion-section="${target}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return !!el;
}

function openActivityTray(): boolean {
  useCompanionStore.getState().setActivityTrayCollapsed(false);
  const el = document.querySelector('[data-testid="companion-activity-tray"]');
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return true;
}

/**
 * Open the thing a reference link names. Returns false when the kind or handle
 * is not something this build can open (the link then does nothing, and
 * `resolvableRef` has already rendered it as plain text for the unknown cases).
 */
export function openRef(kind: RefKind, handle: string, overrides: RefOpenerOverrides = {}): boolean {
  switch (kind) {
    case 'approval':
      if (overrides.openWork) {
        overrides.openWork(`approval:${handle}`);
        return true;
      }
      return jumpToStack('approvals');
    case 'card':
    case 'decision':
      if (overrides.openWork) {
        overrides.openWork(`${kind}:${handle}`);
        return true;
      }
      return jumpToStack('chat-cards');
    case 'report':
      if (overrides.openReport) overrides.openReport(handle);
      else useCompanionStore.getState().setReportViewId(handle);
      return true;
    case 'session': {
      const sys = useSystemStore.getState();
      sys.fleetSetActiveSession(handle);
      sys.fleetSetGridOpen(true);
      return true;
    }
    case 'job':
      return openActivityTray();
    case 'memory': {
      const brainKind = brainKindOfId(handle);
      if (!brainKind) return false;
      useCompanionStore.getState().setBrainView({ open: true, kind: brainKind, id: handle });
      return true;
    }
    case 'goal':
      // The goals board has no per-goal deep link yet; the board is the door.
      openGoalsBoard();
      return true;
    case 'persona':
      useAgentStore.getState().selectPersona(handle);
      useSystemStore.getState().setSidebarSection('personas');
      return true;
  }
}

/** Whether a link can render as a link at all (a memory id of an unknown kind cannot). */
export function resolvableRef(kind: RefKind, handle: string): boolean {
  if (!handle) return false;
  if (kind === 'memory') return brainKindOfId(handle) !== null;
  return true;
}
