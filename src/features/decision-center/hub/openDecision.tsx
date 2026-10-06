/**
 * openDecision — THE router from a decision item to the surface that opens it.
 *
 * One switch ({@link surfaceOf}) and one renderer, on purpose: until the
 * Decision Center's shared modal lands, every kind opens the EXISTING surface
 * that already knows how to show it, and when the modal lands the
 * consolidation package replaces exactly this file.
 *
 *   review · question · policy · evolution · goal · approval
 *                        → TriageFocus in a BaseModal      (FocusSurface)
 *   idea                 → BacklogDetailModal              (BacklogSurface)
 *   incident             → IncidentDetailModal             (IncidentSurface)
 *   report               → ReportDetailModal               (ReportSurface)
 *   council              → the Council page, by its deep link (no modal)
 *   message              → RailThreadModal / PersonaConversation (ThreadSurface)
 *
 * The council is a NAVIGATION, not a surface: it leaves the Monitor for the
 * Curator's council page with the subject pre-selected (`pendingCouncilSubjectId`,
 * which `CouncilPage` consumes on mount — the same hand-off `FeatureChip` and
 * `FeaturesPage` use), so the Monitor overlay is closed on the way out.
 */
import { useCallback, useState, type ReactNode } from 'react';

import { navigateToCompanions } from '@/features/companions/navigation';
import type { FeedTeam } from '@/features/fleet/monitor/channels/types';
import { useSystemStore } from '@/stores/systemStore';

import type { DecisionKind, DecisionItem } from '../model/decisionModel';
import type { RosterDecision } from '../roster/decisionDispatch';
import { BacklogSurface } from './surfaces/BacklogSurface';
import { FocusSurface } from './surfaces/FocusSurface';
import { IncidentSurface, ReportSurface } from './surfaces/RowDetailSurfaces';
import { ThreadSurface } from './surfaces/ThreadSurface';

/** The roster's `decide`, as every surface receives it. Rejects on a failed write. */
export type HubDecide = (decision: RosterDecision) => Promise<void>;

export type DecisionSurfaceKind = 'focus' | 'backlog' | 'incident' | 'report' | 'council' | 'thread';

/** THE switch. Exhaustive over `DecisionKind`: a new kind fails to compile here. */
export function surfaceOf(kind: DecisionKind): DecisionSurfaceKind {
  switch (kind) {
    case 'review':
    case 'question':
    case 'policy':
    case 'evolution':
    case 'goal':
    case 'approval':
      return 'focus';
    case 'idea':
      return 'backlog';
    case 'incident':
      return 'incident';
    case 'report':
      return 'report';
    case 'council':
      return 'council';
    case 'message':
      return 'thread';
  }
}

function openCouncil(subjectId: string): void {
  const sys = useSystemStore.getState();
  sys.setPendingCouncilSubjectId(subjectId);
  navigateToCompanions('curator:council');
  sys.setHeaderOverlay('none');
}

interface Opened {
  item: DecisionItem;
  /** The list it was opened from — the focus surface walks it. */
  queue: readonly DecisionItem[];
}

export interface DecisionOpener {
  /** Open `item`; `queue` is the list it was opened from (default: just it). */
  open: (item: DecisionItem, queue?: readonly DecisionItem[]) => void;
  close: () => void;
  /** The open surface, to mount once. Null when nothing is open. */
  surface: ReactNode;
  isOpen: boolean;
}

export function useDecisionOpener({
  decide, refresh, feedTeams,
}: {
  decide: HubDecide;
  /** Re-read the roster after a surface changed a row through its own door. */
  refresh: () => void;
  feedTeams: readonly FeedTeam[];
}): DecisionOpener {
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = useCallback(() => setOpened(null), []);

  const open = useCallback((item: DecisionItem, queue: readonly DecisionItem[] = [item]) => {
    if (surfaceOf(item.kind) === 'council') {
      openCouncil(item.sourceId);
      return;
    }
    setOpened({ item, queue });
  }, []);

  let surface: ReactNode = null;
  if (opened) {
    const { item, queue } = opened;
    const key = item.id;
    switch (surfaceOf(item.kind)) {
      case 'focus':
        surface = (
          <FocusSurface
            key={key}
            item={item}
            queue={queue.filter((q) => surfaceOf(q.kind) === 'focus')}
            decide={decide}
            onClose={close}
          />
        );
        break;
      case 'backlog':
        surface = <BacklogSurface key={key} item={item} decide={decide} onClose={close} />;
        break;
      case 'incident':
        surface = <IncidentSurface key={key} item={item} onChanged={refresh} onClose={close} />;
        break;
      case 'report':
        surface = <ReportSurface key={key} item={item} onChanged={refresh} onClose={close} />;
        break;
      case 'thread':
        surface = <ThreadSurface key={key} item={item} feedTeams={feedTeams} onClose={close} />;
        break;
      case 'council':
        break;
    }
  }

  return { open, close, surface, isOpen: opened !== null };
}
