import { TeamAssignmentBoardFlightDeck } from './TeamAssignmentBoardFlightDeck';

/**
 * Assignment board — the team's work surface inside the Studio.
 *
 * Consolidated to the FLIGHT DECK direction (prototype round of 2026-06-05):
 * a mission-control layout — phase-grouped mission rail with live step-progress
 * strips on the left, the selected assignment's full step relay (per-step
 * personas, statuses, QA rework rounds, expandable outputs, inline review
 * intervention) in deep focus on the right. The previous bare-card kanban and
 * the Flow Lanes variant were retired with the consolidation.
 */
export function TeamAssignmentBoard({ teamId }: { teamId: string }) {
  return <TeamAssignmentBoardFlightDeck teamId={teamId} />;
}

export default TeamAssignmentBoard;
