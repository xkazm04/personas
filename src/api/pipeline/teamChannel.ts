import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { TeamChannelMessage } from '@/lib/bindings/TeamChannelMessage';

/** One page of the team's channel, newest first. `before` = exclusive RFC3339 cursor. */
export const listTeamChannel = (teamId: string, limit?: number, before?: string) =>
  invoke<TeamChannelItem[]>('list_team_channel', {
    teamId,
    limit: limit ?? null,
    before: before ?? null,
  });

/** Post a user directive into the channel (delivered at step boundaries, with receipts). */
export const postTeamDirective = (teamId: string, content: string, replyTo?: string) =>
  invoke<TeamChannelMessage>('post_team_directive', { teamId, content, replyTo: replyTo ?? null });
