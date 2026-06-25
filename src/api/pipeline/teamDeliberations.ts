// Design D — team deliberation commands (D6 frontend bridge). Mirrors the
// teamChannel api wrapper: invokeWithTimeout + camelCase args (Tauri maps to
// the snake_case Rust params). See src-tauri/src/commands/teams/deliberations.rs.
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import type { DeliberationAgendaItem } from '@/lib/bindings/DeliberationAgendaItem';
import type { TeamChannelMessage } from '@/lib/bindings/TeamChannelMessage';
import type { CompanionAssignTeamResult } from '@/lib/bindings/CompanionAssignTeamResult';

/** Open a deliberation on a team (the DB enforces one active per team).
 *  `costBudgetUsd` is the hard cost floor + the "Run to budget" stop (null ⇒
 *  unbounded — the run loop then ends on convergence / round cap instead). */
export const createTeamDeliberation = (
  teamId: string,
  topic: string,
  goal?: string,
  costBudgetUsd?: number,
) =>
  invoke<TeamDeliberation>('create_team_deliberation', {
    teamId,
    topic,
    goal: goal ?? null,
    createdBy: null,
    costBudgetUsd: costBudgetUsd ?? null,
  });

/** All deliberations for a team, newest-first. */
export const listTeamDeliberations = (teamId: string) =>
  invoke<TeamDeliberation[]>('list_team_deliberations', { teamId });

export const getTeamDeliberation = (deliberationId: string) =>
  invoke<TeamDeliberation>('get_team_deliberation', { deliberationId });

export const listDeliberationAgenda = (deliberationId: string) =>
  invoke<DeliberationAgendaItem[]>('list_deliberation_agenda', { deliberationId });

/** The deliberation's turns (persona/system messages), oldest-first. */
export const listDeliberationTurns = (deliberationId: string, limit?: number) =>
  invoke<TeamChannelMessage[]>('list_deliberation_turns', {
    deliberationId,
    limit: limit ?? null,
  });

/** Advance a deliberation by one moderated round on demand (user-initiated;
 *  not gated by the autonomous flag). Returns the updated deliberation. */
export const advanceTeamDeliberation = (deliberationId: string) =>
  // One round fans out to a Haiku moderator + up to 3 persona turns (+ a proposal
  // synthesis on convergence) — well past the 90s default. Give it 4 minutes.
  invoke<TeamDeliberation>(
    'advance_team_deliberation',
    { deliberationId },
    { timeoutMs: 240_000 },
  );

/** Approve a gated mid-deliberation capability action (decision 8): runs the
 *  persona's capability for real, posts its output back as a turn, resumes the
 *  conversation. Long — the capability executes — so give it a wide timeout. */
export const approveDeliberationAction = (deliberationId: string) =>
  invoke<TeamDeliberation>(
    'approve_deliberation_action',
    { deliberationId },
    { timeoutMs: 300_000 },
  );

/** Skip a gated capability action — decline it and resume discussion. */
export const skipDeliberationAction = (deliberationId: string) =>
  invoke<TeamDeliberation>('skip_deliberation_action', { deliberationId });

/** Decision gate (always gated): approve a resolved proposal → spawns a real
 *  team assignment via companion_assign_team. Returns the assignment id. */
export const approveDeliberationProposal = (deliberationId: string) =>
  invoke<CompanionAssignTeamResult>('approve_deliberation_proposal', { deliberationId });

export const dismissDeliberationProposal = (deliberationId: string) =>
  invoke<void>('dismiss_deliberation_proposal', { deliberationId });
