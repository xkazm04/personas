import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';
import type { PersonaChannelKindCounts } from '@/lib/bindings/PersonaChannelKindCounts';
import type { PostedPersonaChannelMessage } from '@/lib/bindings/PostedPersonaChannelMessage';

/** The lenses `list_persona_channel` can be filtered to. Omitting `kinds`
 *  blends all five — the persona conversation is the blended read. */
export type PersonaChannelKind = 'chat' | 'report' | 'review' | 'event' | 'memory';

/** Exclusive COMPOSITE keyset cursor — `at` is second-resolution, so pass the
 *  last item's `id` too (same contract as the team channel). */
export interface PersonaChannelCursor {
  at: string;
  id: string;
}

/**
 * One page of a persona's channel, newest first — the channels-v2 Lane B
 * read-model (chat ∪ reports ∪ reviews ∪ events ∪ memories).
 */
export const listPersonaChannel = (
  personaId: string,
  limit?: number,
  before?: PersonaChannelCursor,
  kinds?: PersonaChannelKind[],
) =>
  invoke<PersonaChannelItem[]>('list_persona_channel', {
    personaId,
    limit: limit ?? null,
    before: before?.at ?? null,
    beforeId: before?.id ?? null,
    kinds: kinds ?? null,
  });

/** Per-kind row counts for a persona's channel (the facet rail). */
export const countPersonaChannelKinds = (personaId: string) =>
  invoke<PersonaChannelKindCounts>('count_persona_channel_kinds', { personaId });

/**
 * Post a user message into a persona's channel and kick off the follow-up
 * execution. Returns once the row is durable; the persona's reply arrives
 * later as its own row, announced via `EventName.PERSONA_CHANNEL_MESSAGE`.
 *
 * `clientId`: frontend-minted row id (optimistic-echo retire contract — the
 * echo row and the server row share an id, so the head merge retires the
 * ghost instead of duplicating it).
 */
export const postPersonaChannelMessage = (personaId: string, content: string, clientId?: string) =>
  invoke<PostedPersonaChannelMessage>('post_persona_channel_message', {
    personaId,
    content,
    clientId: clientId ?? null,
  });
