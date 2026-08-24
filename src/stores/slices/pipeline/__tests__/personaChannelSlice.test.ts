import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPersonaChannel = vi.fn();
const postPersonaChannelMessage = vi.fn();

vi.mock('@/api/pipeline/personaChannel', () => ({
  listPersonaChannel: (...args: unknown[]) => listPersonaChannel(...args),
  postPersonaChannelMessage: (...args: unknown[]) => postPersonaChannelMessage(...args),
}));

import { usePipelineStore } from '@/stores/pipelineStore';
import {
  countPersonaUnread,
  EMPTY_PERSONA_CHANNEL,
  PERSONA_CHANNEL_PAGE,
  type PersonaChannelState,
} from '../personaChannelSlice';
import type { PersonaChannelItem } from '@/lib/bindings/PersonaChannelItem';

/** Minimal channel item — only the fields the slice actually reads. */
function item(
  id: string,
  at: string,
  kind = 'chat',
  authorKind = 'persona',
  patch: Partial<PersonaChannelItem> = {},
): PersonaChannelItem {
  return {
    id,
    kind,
    at,
    authorKind,
    title: null,
    body: null,
    reportId: null,
    reviewId: null,
    severity: null,
    suggestedActions: null,
    executionId: null,
    replyTo: null,
    extra: null,
    ...patch,
  };
}

function page(prefix: string, at: string, n = PERSONA_CHANNEL_PAGE): PersonaChannelItem[] {
  return Array.from({ length: n }, (_, i) => item(`${prefix}${i}`, at));
}

function resetStore() {
  usePipelineStore.setState({
    personaChannels: {},
    personaChannelSubs: {},
    personaChannelPreviews: {},
  });
  listPersonaChannel.mockReset();
  postPersonaChannelMessage.mockReset();
  localStorage.clear();
}

describe('personaChannelSlice — refcounted subscription', () => {
  beforeEach(resetStore);

  it('fetches once for the first subscriber, releases idempotently', async () => {
    listPersonaChannel.mockResolvedValue([item('pch-a', '2026-08-24T10:00:00Z')]);
    const { subscribePersonaChannel } = usePipelineStore.getState();

    const releaseA = subscribePersonaChannel('p1');
    const releaseB = subscribePersonaChannel('p1');
    await vi.waitFor(() =>
      expect(usePipelineStore.getState().personaChannels['p1']?.loaded).toBe(true),
    );

    expect(listPersonaChannel).toHaveBeenCalledTimes(1);
    expect(usePipelineStore.getState().personaChannelSubs['p1']).toBe(2);

    releaseA();
    releaseA(); // StrictMode double-cleanup must not underflow
    expect(usePipelineStore.getState().personaChannelSubs['p1']).toBe(1);
    releaseB();
    expect(usePipelineStore.getState().personaChannelSubs['p1']).toBeUndefined();
    // Cache stays warm after the last release.
    expect(usePipelineStore.getState().personaChannels['p1']?.items).toHaveLength(1);
  });

  it('refreshSubscribedPersonaChannels touches subscribed personas only', async () => {
    listPersonaChannel.mockResolvedValue([]);
    const st = usePipelineStore.getState();
    st.subscribePersonaChannel('p1');
    st.subscribePersonaChannel('p2');
    await vi.waitFor(() => expect(listPersonaChannel).toHaveBeenCalledTimes(2));
    listPersonaChannel.mockClear();

    await usePipelineStore.getState().refreshSubscribedPersonaChannels();
    expect(listPersonaChannel.mock.calls.map((c) => c[0]).sort()).toEqual(['p1', 'p2']);
  });
});

describe('personaChannelSlice — head refresh mechanics', () => {
  beforeEach(resetStore);

  it('keeps item identity across a quiet refresh and skips the store write', async () => {
    const head = [item('pch-a', '2026-08-24T10:00:00Z'), item('prep-b', '2026-08-24T09:00:00Z', 'report')];
    listPersonaChannel.mockResolvedValue(head);
    const { refreshPersonaChannel } = usePipelineStore.getState();

    await refreshPersonaChannel('p1');
    const first = usePipelineStore.getState().personaChannels['p1']!;

    // Fresh objects, same facts.
    listPersonaChannel.mockResolvedValue(head.map((i) => ({ ...i })));
    await refreshPersonaChannel('p1');
    const second = usePipelineStore.getState().personaChannels['p1']!;

    expect(second).toBe(first); // identity-preserving no-op: no state write at all
  });

  it('a short FIRST page marks the channel exhausted', async () => {
    listPersonaChannel.mockResolvedValue([item('pch-a', '2026-08-24T10:00:00Z')]);
    await usePipelineStore.getState().refreshPersonaChannel('p1');
    expect(usePipelineStore.getState().personaChannels['p1']?.exhausted).toBe(true);
  });

  it('refresh also updates the sidebar preview to the head row', async () => {
    listPersonaChannel.mockResolvedValue([item('pch-a', '2026-08-24T10:00:00Z')]);
    await usePipelineStore.getState().refreshPersonaChannel('p1');
    expect(usePipelineStore.getState().personaChannelPreviews['p1']?.id).toBe('pch-a');
  });

  it('loadOlder pages with the COMPOSITE (at, id) cursor and dedupes', async () => {
    listPersonaChannel.mockResolvedValue(page('pch-h', '2026-08-24T10:00:00Z'));
    await usePipelineStore.getState().refreshPersonaChannel('p1');

    listPersonaChannel.mockClear();
    listPersonaChannel.mockResolvedValue([item('pch-old', '2026-08-23T10:00:00Z')]);
    await usePipelineStore.getState().loadOlderPersonaChannel('p1');

    const call = listPersonaChannel.mock.calls[0]!;
    expect(call[0]).toBe('p1');
    expect(call[2]).toEqual({ at: '2026-08-24T10:00:00Z', id: `pch-h${PERSONA_CHANNEL_PAGE - 1}` });
    const st = usePipelineStore.getState().personaChannels['p1']!;
    expect(st.items[st.items.length - 1]?.id).toBe('pch-old');
    expect(st.exhausted).toBe(true); // short older page = start of history
  });
});

describe('personaChannelSlice — optimistic echo', () => {
  beforeEach(resetStore);

  it('renders the echo instantly and retires it when the server row arrives', async () => {
    listPersonaChannel.mockResolvedValue([]);
    let resolvePost: (v: unknown) => void;
    postPersonaChannelMessage.mockImplementation(
      () => new Promise((res) => { resolvePost = res; }),
    );

    const send = usePipelineStore.getState().sendPersonaChannelMessage('p1', 'hello');
    // Echo is there before the IPC resolves.
    const during = usePipelineStore.getState().personaChannels['p1']!;
    expect(during.echoes).toHaveLength(1);
    expect(during.echoes[0]!.body).toBe('hello');
    expect(during.posting).toBe(true);

    // The clientId passed to the command matches the echo's raw id.
    const [pid, content, clientId] = postPersonaChannelMessage.mock.calls[0]!;
    expect([pid, content]).toEqual(['p1', 'hello']);
    expect(during.echoes[0]!.id).toBe(`pch-${clientId}`);

    // Server confirms; the refresh returns the durable row with the SAME id.
    listPersonaChannel.mockResolvedValue([
      item(`pch-${clientId}`, '2026-08-24T10:00:00Z', 'chat', 'user', { body: 'hello' }),
    ]);
    resolvePost!({ id: clientId, at: '2026-08-24T10:00:00Z' });
    await send;

    const after = usePipelineStore.getState().personaChannels['p1']!;
    expect(after.echoes).toHaveLength(0); // retired, not duplicated
    expect(after.items.map((i) => i.id)).toEqual([`pch-${clientId}`]);
    expect(after.posting).toBe(false);
  });

  it('marks the echo failed in place when the post rejects', async () => {
    postPersonaChannelMessage.mockRejectedValue(new Error('offline'));
    await expect(
      usePipelineStore.getState().sendPersonaChannelMessage('p1', 'hello'),
    ).rejects.toThrow('offline');
    const st = usePipelineStore.getState().personaChannels['p1']!;
    expect(st.echoes).toHaveLength(1);
    expect(st.echoes[0]!.extra).toBe('{"failed":true}');
    expect(st.posting).toBe(false);
  });

  it('consecutive sends queue — send is never gated on the previous one', async () => {
    listPersonaChannel.mockResolvedValue([]);
    postPersonaChannelMessage.mockReturnValue(new Promise(() => {})); // never resolves
    void usePipelineStore.getState().sendPersonaChannelMessage('p1', 'one');
    void usePipelineStore.getState().sendPersonaChannelMessage('p1', 'two');
    expect(usePipelineStore.getState().personaChannels['p1']?.echoes).toHaveLength(2);
  });
});

describe('personaChannelSlice — push routing (notifyPersonaChannel)', () => {
  beforeEach(resetStore);

  it('refreshes the announced persona only, and only when subscribed or previewed', async () => {
    listPersonaChannel.mockResolvedValue([]);
    const st = usePipelineStore.getState();
    st.subscribePersonaChannel('p1');
    await vi.waitFor(() => expect(listPersonaChannel).toHaveBeenCalledTimes(1));
    listPersonaChannel.mockClear();

    // Subscribed → full head refresh (PERSONA_CHANNEL_PAGE).
    await usePipelineStore.getState().notifyPersonaChannel('p1');
    expect(listPersonaChannel).toHaveBeenCalledTimes(1);
    expect(listPersonaChannel.mock.calls[0]![1]).toBe(PERSONA_CHANNEL_PAGE);
    listPersonaChannel.mockClear();

    // Unknown persona → nothing at all.
    await usePipelineStore.getState().notifyPersonaChannel('p-unknown');
    expect(listPersonaChannel).not.toHaveBeenCalled();

    // Previewed-but-not-open → a limit:1 preview refresh, not a head read.
    usePipelineStore.setState((s) => ({
      personaChannelPreviews: { ...s.personaChannelPreviews, p2: null },
    }));
    await usePipelineStore.getState().notifyPersonaChannel('p2');
    expect(listPersonaChannel).toHaveBeenCalledTimes(1);
    expect(listPersonaChannel.mock.calls[0]!.slice(0, 2)).toEqual(['p2', 1]);
  });
});

describe('personaChannelSlice — previews and unread', () => {
  beforeEach(resetStore);

  it('loadPersonaChannelPreviews stores newest-or-null per persona', async () => {
    listPersonaChannel.mockImplementation((id: string) =>
      Promise.resolve(id === 'p1' ? [item('pch-a', '2026-08-24T10:00:00Z')] : []),
    );
    await usePipelineStore.getState().loadPersonaChannelPreviews(['p1', 'p2']);
    const { personaChannelPreviews } = usePipelineStore.getState();
    expect(personaChannelPreviews['p1']?.id).toBe('pch-a');
    expect(personaChannelPreviews['p2']).toBeNull(); // loaded-and-empty ≠ never loaded
  });

  it('countPersonaUnread counts persona output past the watermark, never the user', () => {
    const state: PersonaChannelState = {
      ...EMPTY_PERSONA_CHANNEL,
      lastSeenAt: '2026-08-24T09:00:00Z',
      items: [
        item('pch-u', '2026-08-24T11:00:00Z', 'chat', 'user'), // yours — never unread
        item('pch-p', '2026-08-24T10:30:00Z', 'chat', 'persona'),
        item('prep-r', '2026-08-24T10:00:00Z', 'report'),
        item('pev-e', '2026-08-24T08:00:00Z', 'event'), // behind the watermark
      ],
    };
    expect(countPersonaUnread(state)).toBe(2);
  });

  it('markPersonaChannelSeen persists the newest at and updates state', async () => {
    listPersonaChannel.mockResolvedValue([item('pch-a', '2026-08-24T10:00:00Z')]);
    await usePipelineStore.getState().refreshPersonaChannel('p1');
    usePipelineStore.getState().markPersonaChannelSeen('p1');
    expect(usePipelineStore.getState().personaChannels['p1']?.lastSeenAt).toBe(
      '2026-08-24T10:00:00Z',
    );
    expect(localStorage.getItem('personas.channel.lastSeen.persona:p1')).toBe(
      '2026-08-24T10:00:00Z',
    );
  });
});
