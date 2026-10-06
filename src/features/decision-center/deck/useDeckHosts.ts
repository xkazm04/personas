/**
 * useDeckHosts — where the deck's navigating branches go.
 *
 * The roster cannot route (`DecisionRosterHosts`); the deck is mounted above
 * every surface, so it owns the routes itself, each one the app's existing
 * hand-off, never a new one:
 *  - open in builder  -> Personas > the persona, matrix tab (QuickAnswerPopover's)
 *  - open run         -> `pendingExecutionFocus` + Overview > Executions
 *  - goals board      -> the goal's project, Teams > Goals > Board
 *  - report follow-up -> `openReportInChat` (cockpit + seeded companion chat)
 *
 * Every route closes the deck AND any header overlay (the Monitor) first, so
 * the place it lands on is the place the person sees.
 *
 * The report follow-up needs the report row and its same-run reviews, which
 * the roster's `onOpenChat(personaId)` does not carry: the host primes them in
 * `followUp` just before the write that ends in that call.
 */
import { useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { openReportInChat } from '@/features/overview/sub_reports/libs/openReportInChat';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import type { DecisionRosterHosts } from '../useDecisionRoster';
import type { DecisionItem } from '../model/decisionModel';
import { closeDecisionDeck } from './deckStore';
import { reportOf } from './useReportDoors';

export interface FollowUp {
  item: DecisionItem;
  linkedReviews: PersonaManualReview[];
}

function leaveDeck(): void {
  closeDecisionDeck();
  useSystemStore.getState().setHeaderOverlay('none');
}

export function useDeckHosts() {
  const { t } = useTranslation();
  const reportLabel = t.overview.reports_view.report_label;
  const followUp = useRef<FollowUp | null>(null);

  const hosts = useMemo<DecisionRosterHosts>(() => ({
    onOpenBuilder: (personaId) => {
      leaveDeck();
      const sys = useSystemStore.getState();
      sys.setSidebarSection('personas');
      sys.setEditorTab('matrix');
      useAgentStore.getState().selectPersona(personaId);
    },
    onOpenRun: (executionId) => {
      leaveDeck();
      const overview = useOverviewStore.getState();
      overview.setPendingExecutionFocus(executionId);
      overview.setOverviewTab('executions');
      useSystemStore.getState().setSidebarSection('overview');
    },
    onOpenGoalBoard: (projectId) => {
      leaveDeck();
      const sys = useSystemStore.getState();
      void sys.setActiveProject(projectId);
      sys.setSidebarSection('teams');
      sys.setTeamsTab('goals');
      sys.setGoalsTab('board');
    },
    onOpenChat: (personaId) => {
      const primed = followUp.current;
      followUp.current = null;
      leaveDeck();
      if (primed && (primed.item.payload?.personaId ?? primed.item.personaId) === personaId) {
        openReportInChat(reportOf(primed.item), primed.linkedReviews, reportLabel);
      }
    },
  }), [reportLabel]);

  return { hosts, followUp };
}
