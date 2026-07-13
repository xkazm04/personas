import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { TeamChannelMessage } from '@/lib/bindings/TeamChannelMessage';

/** The lenses `list_team_channel` can be filtered to. Omitting `kinds` blends
 *  all of them except `deliberation` (deliberation turns are opt-in — they are
 *  not part of the plain conversation). */
export type ChannelKind = 'step' | 'event' | 'memory' | 'message' | 'deliberation';

/** Exclusive COMPOSITE keyset cursor. `at` alone is only second-resolution, so
 *  a burst of rows sharing one second across a page boundary would be dropped;
 *  pass the last item's `id` too. */
export interface ChannelCursor {
  at: string;
  id: string;
}

/**
 * One page of the team's channel, newest first.
 *
 * `kinds` is pushed down into SQL — each source query is limited independently,
 * so asking for one lens spends the whole page budget on it. (Previously all
 * four sources ran with `LIMIT n` and the union was truncated to `n` total, so
 * a chatty step layer could starve every memory out of the page.)
 */
export const listTeamChannel = (
  teamId: string,
  limit?: number,
  before?: ChannelCursor,
  kinds?: ChannelKind[],
) =>
  invoke<TeamChannelItem[]>('list_team_channel', {
    teamId,
    limit: limit ?? null,
    before: before?.at ?? null,
    beforeId: before?.id ?? null,
    kinds: kinds ?? null,
  });

/** Post a user directive into the channel (delivered at step boundaries, with receipts). */
export const postTeamDirective = (teamId: string, content: string, replyTo?: string) =>
  invoke<TeamChannelMessage>('post_team_directive', { teamId, content, replyTo: replyTo ?? null });
