// Design D — team deliberation commands (D6 frontend bridge). Mirrors the
// teamChannel api wrapper: invokeWithTimeout + camelCase args (Tauri maps to
// the snake_case Rust params). See src-tauri/src/commands/teams/deliberations.rs.
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import type { DeliberationAgendaItem } from '@/lib/bindings/DeliberationAgendaItem';
import type { TeamChannelMessage } from '@/lib/bindings/TeamChannelMessage';
import type { CompanionAssignTeamResult } from '@/lib/bindings/CompanionAssignTeamResult';

/** Open a deliberation on a team (the DB enforces one active per team). */
export const createTeamDeliberation = (teamId: string, topic: string, goal?: string) =>
  invoke<TeamDeliberation>('create_team_deliberation', {
    teamId,
    topic,
    goal: goal ?? null,
    createdBy: null,
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

/** Decision gate (always gated): approve a resolved proposal → spawns a real
 *  team assignment via companion_assign_team. Returns the assignment id. */
export const approveDeliberationProposal = (deliberationId: string) =>
  invoke<CompanionAssignTeamResult>('approve_deliberation_proposal', { deliberationId });

export const dismissDeliberationProposal = (deliberationId: string) =>
  invoke<void>('dismiss_deliberation_proposal', { deliberationId });
